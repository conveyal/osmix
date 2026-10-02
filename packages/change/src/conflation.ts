/** Safe, explicit proximity conflation for imported OSM-like datasets. */

import type { Osm } from "@osmix/core";
import { haversineDistance } from "@osmix/geo/haversine-distance";
import type { LonLat, OsmEntity, OsmNode, OsmWay } from "@osmix/types";
import { normalizedWayDirection, type OsmWayDirection } from "@osmix/types/way-direction";

import { OsmChangeset } from "./changeset.ts";
import {
  conflationTagSourceKey,
  conflationTagTargetKey,
  createConflationOutcomeReport,
  type ConflationApplicationTrace,
} from "./conflation-outcome.ts";
import { assertConflationPreservesBaseTopology, restrictionTopologyIssues } from "./integrity.ts";
import { featureTypeConflicts } from "./internal/feature-classification.ts";
import { assessWayRemovals } from "./internal/way-removal.ts";
import type { PlanOverlay } from "./plan/overlay.ts";
import { plannedMatchingViews } from "./plan/views.ts";
import { inputProvenance, type MergeProvenance } from "./provenance.ts";
import { accessSignature } from "./rules/access.ts";
import { isAreaWay } from "./rules/area.ts";
import { hasAdjacentDuplicateRefs, hasTooFewDistinctRefs } from "./rules/collapse.ts";
import { routingGradeSignature } from "./rules/grade.ts";
import { lineBbox, lineLength, symmetricLineDistance } from "./rules/line-geometry.ts";
import {
  assessJunction,
  assessNodeTags,
  canDropReplacedNode,
  type NodeIdentityReason,
} from "./rules/node-identity.ts";
import {
  familyCompatible,
  isProtectedProperty,
  isRoutingProperty,
  routingFamilies,
  wayGradeAccessCompatible,
  wayRoutingFamily,
} from "./rules/routing.ts";
import type {
  OsmConflationActionAssessment,
  OsmConflationCandidate,
  OsmConflationDecision,
  OsmConflationDecisionConflict,
  OsmConflationDiscovery,
  OsmConflationEffectiveStatus,
  OsmConflationEvidence,
  OsmConflationOptions,
  OsmConflationReasonCode,
  OsmConflationResolvedActions,
  OsmConflationSummary,
  OsmConflationTagDiff,
  ResolvedOsmConflationOptions,
} from "./types.ts";
import { type DatasetView, type EntityRelationContext, osmDatasetView } from "./views.ts";

// Preserve the historical one-meter matching radius, but only inside this explicit,
// cross-dataset workflow. Proximity alone never authorizes a topology change.
const DEFAULT_MAX_DISTANCE_METERS = 1;
const MAX_BEARING_DIFFERENCE_DEGREES = 30;
const MAX_LENGTH_DIFFERENCE_RATIO = 0.05;

type DiscoveryContext = {
  base: Osm;
  patch: Osm;
  provenance: MergeProvenance;
  options: ResolvedOsmConflationOptions;
  /** Targets come from the base side, sources from the imported side. */
  baseView: DatasetView;
  patchView: DatasetView;
  baseRelations: EntityRelationContext;
  patchRelations: EntityRelationContext;
};

function resolvedOptions(options: OsmConflationOptions): ResolvedOsmConflationOptions {
  if (!Array.isArray(options.propertyKeys)) {
    throw Error("Conflation propertyKeys must be an array");
  }
  if (options.propertyKeys.some((key) => typeof key !== "string" || key.length === 0)) {
    throw Error("Conflation propertyKeys must contain only non-empty strings");
  }
  if (typeof options.attachNetwork !== "boolean") {
    throw Error("Conflation attachNetwork must be a boolean");
  }
  if (options.allowWayRemoval !== undefined && typeof options.allowWayRemoval !== "boolean") {
    throw Error("Conflation allowWayRemoval must be a boolean");
  }
  if (
    options.allowWayReplacement !== undefined &&
    typeof options.allowWayReplacement !== "boolean"
  ) {
    throw Error("Conflation allowWayReplacement must be a boolean");
  }
  const replacementToleranceMeters =
    options.replacementToleranceMeters ?? DEFAULT_MAX_DISTANCE_METERS;
  if (!Number.isFinite(replacementToleranceMeters) || replacementToleranceMeters <= 0) {
    throw Error("Conflation replacementToleranceMeters must be a positive finite number");
  }
  if (options.automatic != null && !["high-confidence", "none"].includes(options.automatic)) {
    throw Error("Conflation automatic must be high-confidence or none");
  }
  const maxDistanceMeters = options.maxDistanceMeters ?? DEFAULT_MAX_DISTANCE_METERS;
  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0) {
    throw Error("Conflation maxDistanceMeters must be a positive finite number");
  }
  const propertyKeys = [...new Set(options.propertyKeys)].toSorted();
  if (
    propertyKeys.length === 0 &&
    !options.attachNetwork &&
    !options.allowWayRemoval &&
    !options.allowWayReplacement
  ) {
    throw Error(
      "Conflation requires at least one property key, network attachment, explicit way removal, or way replacement",
    );
  }
  return {
    propertyKeys,
    attachNetwork: options.attachNetwork,
    ...(options.allowWayRemoval ? { allowWayRemoval: true } : {}),
    ...(options.allowWayReplacement
      ? { allowWayReplacement: true, replacementToleranceMeters }
      : {}),
    maxDistanceMeters,
    automatic: options.automatic ?? "high-confidence",
  };
}

function candidateId(entityType: "node" | "way", sourceId: number, targetId: number | null) {
  return `${entityType}:${sourceId}->${targetId ?? "none"}`;
}

function uniqueReasons(reasons: readonly OsmConflationReasonCode[]) {
  return [...new Set(reasons)].toSorted();
}

function roundEvidence(value: number) {
  return Number(value.toFixed(6));
}

function wayContextsCompatible(source: OsmWay, target: OsmWay) {
  return (
    familyCompatible(wayRoutingFamily(source), wayRoutingFamily(target)) &&
    wayGradeAccessCompatible(source, target)
  );
}

function reversedOneway(value: OsmWayDirection) {
  return value === "forward" ? "reverse" : value === "reverse" ? "forward" : value;
}

function wayRoutingSemanticsCompatible(
  source: OsmWay,
  target: OsmWay,
  targetReversed: boolean | null,
) {
  const targetOneway = normalizedWayDirection(target.tags);
  const sourceOneway = normalizedWayDirection(source.tags);
  if (
    targetOneway === "unsupported" ||
    sourceOneway === "unsupported" ||
    (targetReversed === null && (sourceOneway !== "both" || targetOneway !== "both")) ||
    sourceOneway !== (targetReversed ? reversedOneway(targetOneway) : targetOneway)
  ) {
    return false;
  }
  const routingKeys = new Set(
    [...Object.keys(source.tags ?? {}), ...Object.keys(target.tags ?? {})].filter(
      (key) => isRoutingProperty(key) && key !== "oneway",
    ),
  );
  if (
    targetReversed !== false &&
    // Reversed or unresolved geometry is safe only when no remaining routing tag
    // has a direction whose meaning would need to be inverted or swapped.
    [...routingKeys].some(
      (key) =>
        key.startsWith("oneway:") ||
        key.split(":").some((part) => ["backward", "forward", "left", "right"].includes(part)),
    )
  ) {
    return false;
  }
  return [...routingKeys].every(
    (key) => String(source.tags?.[key] ?? "") === String(target.tags?.[key] ?? ""),
  );
}

function selectedTagDiff(
  source: OsmEntity,
  target: OsmEntity,
  propertyKeys: readonly string[],
): OsmConflationTagDiff[] {
  const result: OsmConflationTagDiff[] = [];
  for (const key of propertyKeys) {
    const patchValue = source.tags?.[key];
    if (patchValue == null || target.tags?.[key] === patchValue) continue;
    result.push({
      key,
      patchValue,
      baseValue: target.tags?.[key],
      protected: isProtectedProperty(key),
      routing: isRoutingProperty(key),
    });
  }
  return result;
}

function propertyAssessment(
  tagDiff: readonly OsmConflationTagDiff[],
  options: ResolvedOsmConflationOptions,
): OsmConflationActionAssessment {
  if (tagDiff.length === 0) {
    return { status: "blocked", reasons: ["no-transferable-properties"] };
  }
  const transferable = tagDiff.filter((diff) => !diff.protected);
  if (transferable.length === 0) return { status: "blocked", reasons: ["protected-tag"] };

  const reasons: OsmConflationReasonCode[] = [];
  if (transferable.some((diff) => diff.routing)) reasons.push("routing-property");
  if (tagDiff.some((diff) => diff.protected)) reasons.push("protected-tag");
  if (reasons.length > 0 || options.automatic === "none") {
    return { status: "review", reasons: uniqueReasons(reasons) };
  }
  return { status: "automatic", reasons: [] };
}

function nodePropertyAssessment(
  context: DiscoveryContext,
  source: OsmNode,
  target: OsmNode,
  patchWays: readonly OsmWay[],
  baseWays: readonly OsmWay[],
  tagDiff: readonly OsmConflationTagDiff[],
) {
  const assessment = propertyAssessment(tagDiff, context.options);

  const patchAreaOnly = patchWays.length > 0 && patchWays.every(isAreaWay);
  const baseAreaOnly = baseWays.length > 0 && baseWays.every(isAreaWay);
  const patchRoutable = patchWays.filter((way) => wayRoutingFamily(way) !== "non-routable");
  const baseRoutable = baseWays.filter((way) => wayRoutingFamily(way) !== "non-routable");
  const reasons = [...assessment.reasons];
  let hardConflict = false;
  if (patchAreaOnly !== baseAreaOnly && (patchAreaOnly || baseAreaOnly)) {
    reasons.push("non-routing-target");
    hardConflict = true;
  }
  if (patchRoutable.length > 0 && baseRoutable.length > 0) {
    const patchFamilies = routingFamilies(patchRoutable);
    const baseFamilies = routingFamilies(baseRoutable);
    if (
      !patchFamilies.every((family) =>
        baseFamilies.some((baseFamily) => familyCompatible(family, baseFamily)),
      )
    ) {
      reasons.push("routing-family-conflict");
    }
    if (
      !patchRoutable.every((source) =>
        baseRoutable.some((target) => source.tags?.["highway"] === target.tags?.["highway"]),
      )
    ) {
      reasons.push("routing-family-conflict");
    }
    // The same junction rule as a connection (G5): the target must be a point the imported
    // ways could join, not one where some base way is grade-separated from them.
    const junction = assessJunction(target.id, source.id, patchRoutable, baseRoutable, {
      junctionWays: baseWays.filter((way) => way.tags?.["highway"] != null),
    });
    if (junction.includes("grade-conflict")) {
      reasons.push("grade-conflict");
      hardConflict = true;
    }
  } else if (
    (patchRoutable.length > 0 && baseWays.length > 0) ||
    (baseRoutable.length > 0 && patchWays.length > 0)
  ) {
    reasons.push("non-routing-target");
    hardConflict = true;
  }
  assessment.reasons = uniqueReasons(reasons);
  if (hardConflict) assessment.status = "blocked";
  else if (assessment.reasons.length > 0 && assessment.status === "automatic") {
    assessment.status = "review";
  }
  return assessment;
}

function bearing(from: LonLat, to: LonLat) {
  const latitude1 = (from[1] * Math.PI) / 180;
  const latitude2 = (to[1] * Math.PI) / 180;
  const deltaLongitude = ((to[0] - from[0]) * Math.PI) / 180;
  const y = Math.sin(deltaLongitude) * Math.cos(latitude2);
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(deltaLongitude);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function undirectedBearingDifference(a: number, b: number) {
  const directed = Math.abs(a - b) % 360;
  return Math.min(directed, 360 - directed, Math.abs(180 - directed));
}

function nodeSegments(view: DatasetView, nodeId: number, ways: readonly OsmWay[]) {
  const node = view.getNode(nodeId);
  if (!node) return [];
  const segments: { bearing: number; way: OsmWay }[] = [];
  for (const way of ways) {
    for (let index = 0; index < way.refs.length; index++) {
      if (way.refs[index] !== nodeId) continue;
      for (const neighborIndex of [index - 1, index + 1]) {
        const neighborId = way.refs[neighborIndex];
        if (neighborId == null || neighborId === nodeId) continue;
        const neighbor = view.getNode(neighborId);
        if (!neighbor) continue;
        segments.push({
          bearing: bearing([node.lon, node.lat], [neighbor.lon, neighbor.lat]),
          way,
        });
      }
    }
  }
  return segments;
}

/** Rulebook reasons map onto the public reason codes; a tag conflict never applies to connect. */
function toReasonCode(reason: NodeIdentityReason): OsmConflationReasonCode {
  return reason === "tag-conflict" ? "node-context-conflict" : reason;
}

/**
 * Whether connecting `source` to `target` would break a patch turn restriction: the restriction's
 * node members follow the source, and its ways follow the rewritten source ways.
 */
function connectionBreaksRestriction(
  context: DiscoveryContext,
  source: OsmNode,
  target: OsmNode,
  sourceWays: readonly OsmWay[],
) {
  const rewritten = new Map(
    sourceWays.map((way) => [
      way.id,
      { ...way, refs: way.refs.map((ref) => (ref === source.id ? target.id : ref)) },
    ]),
  );
  for (const relation of context.patchView.relations()) {
    if (relation.tags?.["type"] !== "restriction") continue;
    const involved = relation.members.some(
      (member) =>
        (member.type === "node" && member.ref === source.id) ||
        (member.type === "way" && rewritten.has(member.ref)),
    );
    if (!involved) continue;
    const proposed = {
      ...relation,
      members: relation.members.map((member) =>
        member.type === "node" && member.ref === source.id ? { ...member, ref: target.id } : member,
      ),
    };
    const issues = restrictionTopologyIssues(
      proposed,
      (id) => rewritten.get(id) ?? context.patchView.getWay(id) ?? context.baseView.getWay(id),
    );
    if (issues.length > 0) return true;
  }
  return false;
}

function nodeAttachmentAssessment(
  context: DiscoveryContext,
  source: OsmNode,
  target: OsmNode,
  patchWays: readonly OsmWay[],
  baseWays: readonly OsmWay[],
): { assessment: OsmConflationActionAssessment; evidence: Partial<OsmConflationEvidence> } {
  if (!context.options.attachNetwork)
    return { assessment: { status: "blocked", reasons: [] }, evidence: {} };
  const sourceWays = patchWays.filter(
    (way) =>
      context.provenance.isImported("way", way.id) && wayRoutingFamily(way) !== "non-routable",
  );
  const targetWays = baseWays.filter((way) => wayRoutingFamily(way) !== "non-routable");
  if (sourceWays.length === 0 || targetWays.length === 0) {
    return {
      assessment: { status: "blocked", reasons: ["non-routing-target"] },
      evidence: { patchWayIds: sourceWays.map((way) => way.id).toSorted((a, b) => a - b) },
    };
  }

  // Hard reasons describe invariants a manual decision cannot override. Review
  // reasons are plausible matches whose routing intent still needs a person.
  const nodeTags = assessNodeTags("connect", source.tags, target.tags);
  const hardReasons: OsmConflationReasonCode[] = [...nodeTags.hardReasons].map(toReasonCode);
  const reviewReasons: OsmConflationReasonCode[] = [...nodeTags.reviewReasons].map(toReasonCode);
  const restrictionMember =
    context.patchRelations.restrictionNodes.has(source.id) ||
    context.baseRelations.restrictionNodes.has(target.id) ||
    sourceWays.some((way) => context.patchRelations.restrictionWays.has(way.id)) ||
    targetWays.some((way) => context.baseRelations.restrictionWays.has(way.id));
  const relationMember =
    context.patchRelations.nodes.has(source.id) ||
    context.baseRelations.nodes.has(target.id) ||
    sourceWays.some((way) => context.patchRelations.ways.has(way.id)) ||
    targetWays.some((way) => context.baseRelations.ways.has(way.id));
  // Relation node members follow the connection. A restriction the rewrite would break blocks
  // it; any other relation involvement, including an intact restriction, needs review.
  if (restrictionMember && connectionBreaksRestriction(context, source, target, sourceWays)) {
    hardReasons.push("relation-member");
  } else if (restrictionMember || relationMember) {
    reviewReasons.push("relation-member");
  }

  const sourceFamilies = routingFamilies(sourceWays);
  const targetFamilies = routingFamilies(targetWays);
  if (
    !sourceFamilies.every((family) =>
      targetFamilies.some((targetFamily) => familyCompatible(family, targetFamily)),
    )
  ) {
    reviewReasons.push("routing-family-conflict");
  }
  if (sourceFamilies.includes("motor-road")) reviewReasons.push("drivable-network");
  if (
    !sourceWays.every((sourceWay) =>
      targetWays.some((targetWay) => sourceWay.tags?.["highway"] === targetWay.tags?.["highway"]),
    )
  ) {
    reviewReasons.push("routing-family-conflict");
  }

  hardReasons.push(
    ...assessJunction(target.id, source.id, sourceWays, targetWays, {
      junctionWays: baseWays.filter((way) => way.tags?.["highway"] != null),
    }).map(toReasonCode),
  );

  const sourceSegments = nodeSegments(context.patchView, source.id, sourceWays);
  const targetSegments = nodeSegments(context.baseView, target.id, targetWays);
  let maximumMinimumBearingDifference = 0;
  // Every imported incident segment needs at least one compatible base segment.
  // Taking the worst best-match prevents one aligned arm from hiding another.
  for (const sourceSegment of sourceSegments) {
    const compatibleTargets = targetSegments.filter((targetSegment) =>
      wayContextsCompatible(sourceSegment.way, targetSegment.way),
    );
    const minimum = compatibleTargets.reduce(
      (value, targetSegment) =>
        Math.min(value, undirectedBearingDifference(sourceSegment.bearing, targetSegment.bearing)),
      Number.POSITIVE_INFINITY,
    );
    maximumMinimumBearingDifference = Math.max(maximumMinimumBearingDifference, minimum);
  }
  if (
    sourceSegments.length === 0 ||
    !Number.isFinite(maximumMinimumBearingDifference) ||
    maximumMinimumBearingDifference > MAX_BEARING_DIFFERENCE_DEGREES
  ) {
    reviewReasons.push("bearing-mismatch");
  }

  const reasons = uniqueReasons([...hardReasons, ...reviewReasons]);
  const status =
    hardReasons.length > 0
      ? "blocked"
      : reviewReasons.length > 0 || context.options.automatic === "none"
        ? "review"
        : "automatic";
  return {
    assessment: { status, reasons },
    evidence: {
      patchWayIds: sourceWays.map((way) => way.id).toSorted((a, b) => a - b),
      bearingDifferenceDegrees: Number.isFinite(maximumMinimumBearingDifference)
        ? roundEvidence(maximumMinimumBearingDifference)
        : undefined,
    },
  };
}

function overallAssessment(
  property: OsmConflationActionAssessment,
  attachment: OsmConflationActionAssessment | null,
  options: ResolvedOsmConflationOptions,
) {
  const enabled = [
    ...(options.propertyKeys.length > 0 ? [property] : []),
    ...(options.attachNetwork && attachment ? [attachment] : []),
  ];
  const reasons = uniqueReasons(enabled.flatMap((assessment) => assessment.reasons));
  if (enabled.some((assessment) => assessment.status === "review")) {
    return { status: "review" as const, reasons };
  }
  if (enabled.some((assessment) => assessment.status === "automatic")) {
    return { status: "automatic" as const, reasons };
  }
  return { status: "blocked" as const, reasons };
}

function addReviewReason(candidate: OsmConflationCandidate, reason: OsmConflationReasonCode) {
  for (const assessment of [candidate.propertyTransfer, candidate.networkAttachment]) {
    if (!assessment) continue;
    if (assessment.status === "automatic") assessment.status = "review";
    assessment.reasons = uniqueReasons([...assessment.reasons, reason]);
  }
  candidate.reasons = uniqueReasons([...candidate.reasons, reason]);
  if (candidate.status === "automatic") candidate.status = "review";
}

function discoverNodeCandidates(context: DiscoveryContext) {
  const candidates: OsmConflationCandidate[] = [];
  for (const source of context.patchView.nodes()) {
    // Same-ID entities belong to ordinary merge semantics; fuzzy matching must not
    // reinterpret an authoritative patch update.
    if (context.provenance.isBase("node", source.id)) continue;
    const patchWays = context.patchView.waysAtNode(source.id);
    const eligible =
      context.options.propertyKeys.some((key) => source.tags?.[key] != null) ||
      (context.options.attachNetwork &&
        patchWays.some((way) => context.provenance.isImported("way", way.id)));
    if (!eligible) continue;

    const nearby = context.baseView.nodesWithinRadius(
      source.lon,
      source.lat,
      context.options.maxDistanceMeters,
    );
    // A base ID also present in the patch is mutable under direct merge, so it is
    // not an immutable target for a different imported entity.
    const targets = nearby.filter((target) => !context.provenance.isPatch("node", target.id));
    if (targets.length === 0) {
      candidates.push({
        id: candidateId("node", source.id, null),
        entityType: "node",
        sourceId: source.id,
        targetId: null,
        status: "unmatched",
        reasons: [],
        propertyTransfer: { status: "unmatched", reasons: [] },
        networkAttachment: context.options.attachNetwork
          ? { status: "unmatched", reasons: [] }
          : null,
        evidence: {
          distanceMeters: Number.POSITIVE_INFINITY,
          sourceRoutingFamilies: routingFamilies(patchWays),
          targetRoutingFamilies: [],
          tagDiff: [],
        },
      });
      continue;
    }

    for (const target of targets.toSorted((a, b) => a.id - b.id)) {
      const baseWays = context.baseView.waysAtNode(target.id);
      const tagDiff = selectedTagDiff(source, target, context.options.propertyKeys);
      const property = nodePropertyAssessment(
        context,
        source,
        target,
        patchWays,
        baseWays,
        tagDiff,
      );
      const attachment = nodeAttachmentAssessment(context, source, target, patchWays, baseWays);
      const typeConflicts = featureTypeConflicts(source.tags, target.tags);
      if (typeConflicts.length > 0) {
        for (const assessment of [property, attachment.assessment]) {
          assessment.status = "blocked";
          assessment.reasons = uniqueReasons([...assessment.reasons, "feature-type-conflict"]);
        }
      }
      if (targets.length > 1) {
        if (property.status === "automatic") property.status = "review";
        if (attachment.assessment.status === "automatic") attachment.assessment.status = "review";
        property.reasons = uniqueReasons([...property.reasons, "multiple-targets"]);
        attachment.assessment.reasons = uniqueReasons([
          ...attachment.assessment.reasons,
          "multiple-targets",
        ]);
      }
      const overall = overallAssessment(property, attachment.assessment, context.options);
      const distanceMeters = haversineDistance([source.lon, source.lat], [target.lon, target.lat]);
      candidates.push({
        id: candidateId("node", source.id, target.id),
        entityType: "node",
        sourceId: source.id,
        targetId: target.id,
        status: overall.status,
        reasons: overall.reasons,
        propertyTransfer: property,
        networkAttachment: context.options.attachNetwork ? attachment.assessment : null,
        evidence: {
          distanceMeters: roundEvidence(distanceMeters),
          sourceRoutingFamilies: routingFamilies(patchWays),
          targetRoutingFamilies: routingFamilies(baseWays),
          tagDiff,
          featureTypeConflicts: typeConflicts.length > 0 ? typeConflicts : undefined,
          ...attachment.evidence,
        },
      });
    }
  }
  return candidates;
}

function endpointDistances(source: readonly LonLat[], target: readonly LonLat[]) {
  const forward: [number, number] = [
    haversineDistance(source[0]!, target[0]!),
    haversineDistance(source.at(-1)!, target.at(-1)!),
  ];
  const reverse: [number, number] = [
    haversineDistance(source[0]!, target.at(-1)!),
    haversineDistance(source.at(-1)!, target[0]!),
  ];
  const forwardDistance = Math.max(...forward);
  const reverseDistance = Math.max(...reverse);
  // Closed ways have identical endpoints in both orientations. A tie must not
  // certify direction equivalence; their winding requires separate evidence.
  if (Math.abs(forwardDistance - reverseDistance) < 1e-6) {
    return { distances: forward, reversed: null };
  }
  return forwardDistance < reverseDistance
    ? { distances: forward, reversed: false }
    : { distances: reverse, reversed: true };
}

function discoverWayCandidates(context: DiscoveryContext) {
  const candidates: OsmConflationCandidate[] = [];
  if (context.options.propertyKeys.length === 0 && !context.options.allowWayRemoval)
    return candidates;
  for (const source of context.patchView.ways()) {
    if (context.provenance.isBase("way", source.id)) continue;
    if (
      !context.options.allowWayRemoval &&
      !context.options.propertyKeys.some((key) => source.tags?.[key] != null)
    )
      continue;
    const sourceCoordinates = context.patchView.wayCoordinates(source);
    if (sourceCoordinates.length < 2) continue;
    const nearbyWays = context.baseView.waysIntersecting(
      lineBbox(sourceCoordinates, context.options.maxDistanceMeters),
    );
    const matches: {
      target: OsmWay;
      reasons: OsmConflationReasonCode[];
      evidence: Pick<
        OsmConflationEvidence,
        | "distanceMeters"
        | "endpointDistancesMeters"
        | "lengthDifferenceRatio"
        | "maxGeometryDistanceMeters"
        | "featureTypeConflicts"
      >;
    }[] = [];
    for (const target of nearbyWays) {
      if (context.provenance.isPatch("way", target.id)) continue;
      const targetCoordinates = context.baseView.wayCoordinates(target);
      if (targetCoordinates.length < 2) continue;
      const endpoints = endpointDistances(sourceCoordinates, targetCoordinates);
      if (Math.max(...endpoints.distances) > context.options.maxDistanceMeters) continue;
      const sourceLength = lineLength(sourceCoordinates);
      const targetLength = lineLength(targetCoordinates);
      const maximumLength = Math.max(sourceLength, targetLength);
      const lengthDifferenceRatio =
        maximumLength === 0 ? 0 : Math.abs(sourceLength - targetLength) / maximumLength;
      const maxGeometryDistanceMeters = symmetricLineDistance(sourceCoordinates, targetCoordinates);
      if (maxGeometryDistanceMeters > context.options.maxDistanceMeters) continue;
      const reasons: OsmConflationReasonCode[] = [];
      const typeConflicts = featureTypeConflicts(source.tags, target.tags);
      if (typeConflicts.length > 0) reasons.push("feature-type-conflict");
      // Keep geometrically plausible conflicts as blocked candidate rows. Users need
      // to see why a nearby way was rejected instead of seeing it as merely unmatched.
      if (isAreaWay(source) !== isAreaWay(target)) reasons.push("geometry-mismatch");
      if (lengthDifferenceRatio > MAX_LENGTH_DIFFERENCE_RATIO) reasons.push("length-mismatch");
      if (routingGradeSignature(source.tags) !== routingGradeSignature(target.tags)) {
        reasons.push("grade-conflict");
      }
      if (
        !familyCompatible(wayRoutingFamily(source), wayRoutingFamily(target)) ||
        accessSignature(source.tags) !== accessSignature(target.tags) ||
        !wayRoutingSemanticsCompatible(source, target, endpoints.reversed)
      ) {
        reasons.push("routing-family-conflict");
      }
      matches.push({
        target,
        reasons: uniqueReasons(reasons),
        evidence: {
          distanceMeters: roundEvidence(maxGeometryDistanceMeters),
          endpointDistancesMeters: endpoints.distances.map(roundEvidence) as [number, number],
          lengthDifferenceRatio: roundEvidence(lengthDifferenceRatio),
          maxGeometryDistanceMeters: roundEvidence(maxGeometryDistanceMeters),
          featureTypeConflicts: typeConflicts.length > 0 ? typeConflicts : undefined,
        },
      });
    }

    if (matches.length === 0) {
      // Multiple nearby base ways may represent a segmented equivalent. This version
      // deliberately reports that case instead of guessing a one-to-many mapping.
      const reasons: OsmConflationReasonCode[] =
        nearbyWays.length > 1 ? ["unsupported-way-chain"] : [];
      candidates.push({
        id: candidateId("way", source.id, null),
        entityType: "way",
        sourceId: source.id,
        targetId: null,
        status: "unmatched",
        reasons,
        propertyTransfer: { status: "unmatched", reasons },
        networkAttachment: null,
        evidence: {
          distanceMeters: Number.POSITIVE_INFINITY,
          sourceRoutingFamilies: [wayRoutingFamily(source)],
          targetRoutingFamilies: [],
          tagDiff: [],
        },
      });
      continue;
    }

    for (const match of matches.toSorted((a, b) => a.target.id - b.target.id)) {
      const tagDiff = selectedTagDiff(source, match.target, context.options.propertyKeys);
      const property = propertyAssessment(tagDiff, context.options);
      if (match.reasons.length > 0) {
        property.status = "blocked";
        property.reasons = uniqueReasons([...property.reasons, ...match.reasons]);
      }
      if (matches.length > 1 && property.status === "automatic") property.status = "review";
      if (matches.length > 1)
        property.reasons = uniqueReasons([...property.reasons, "multiple-targets"]);
      const sourceRelation = context.patchRelations.ways.has(source.id);
      const targetRelation = context.baseRelations.ways.has(match.target.id);
      const restriction =
        context.patchRelations.restrictionWays.has(source.id) ||
        context.baseRelations.restrictionWays.has(match.target.id);
      if (sourceRelation || targetRelation) {
        property.reasons = uniqueReasons([...property.reasons, "relation-member"]);
        if (restriction) property.status = "blocked";
        else if (property.status === "automatic") property.status = "review";
      }
      candidates.push({
        id: candidateId("way", source.id, match.target.id),
        entityType: "way",
        sourceId: source.id,
        targetId: match.target.id,
        status: property.status,
        reasons: property.reasons,
        propertyTransfer: property,
        networkAttachment: null,
        evidence: {
          ...match.evidence,
          sourceRoutingFamilies: [wayRoutingFamily(source)],
          targetRoutingFamilies: [wayRoutingFamily(match.target)],
          tagDiff,
        },
      });
    }
  }
  return candidates;
}

function applyManyToOneClassification(candidates: OsmConflationCandidate[]) {
  // Candidate discovery is local to each source. Enforce the batch-wide one-to-one
  // invariant only after all otherwise plausible pairs are known.
  const sourcesByTarget = new Map<string, Set<number>>();
  for (const candidate of candidates) {
    if (candidate.targetId == null) continue;
    const key = `${candidate.entityType}:${candidate.targetId}`;
    const sources = sourcesByTarget.get(key) ?? new Set();
    sources.add(candidate.sourceId);
    sourcesByTarget.set(key, sources);
  }
  for (const candidate of candidates) {
    if (candidate.targetId == null) continue;
    if ((sourcesByTarget.get(`${candidate.entityType}:${candidate.targetId}`)?.size ?? 0) <= 1)
      continue;
    addReviewReason(candidate, "many-to-one");
  }
}

/** Discover fuzzy candidates strictly between untouched patch and immutable base inputs. */
export function discoverConflationCandidates(
  base: Osm,
  patch: Osm,
  options: OsmConflationOptions,
): OsmConflationDiscovery {
  return discoverOnViews(base, patch, osmDatasetView(base), osmDatasetView(patch), options);
}

/**
 * @internal Discover candidates on a merge plan's state after its direct and identity phases.
 * Imported entities those phases consumed are not sources; targets stay base entities.
 */
export function discoverPlannedConflationCandidates(
  base: Osm,
  planned: Osm,
  overlay: PlanOverlay,
  options: OsmConflationOptions,
): OsmConflationDiscovery {
  const { baseView, patchView } = plannedMatchingViews(
    overlay,
    base,
    planned,
    inputProvenance(base, planned),
  );
  return discoverOnViews(base, planned, baseView, patchView, options);
}

function discoverOnViews(
  base: Osm,
  patch: Osm,
  baseView: DatasetView,
  patchView: DatasetView,
  options: OsmConflationOptions,
): OsmConflationDiscovery {
  const resolved = resolvedOptions(options);
  const context: DiscoveryContext = {
    base,
    patch,
    provenance: inputProvenance(base, patch),
    options: resolved,
    baseView,
    patchView,
    baseRelations: baseView.relationMembership(),
    patchRelations: patchView.relationMembership(),
  };
  const candidates = [
    ...discoverNodeCandidates(context),
    ...discoverWayCandidates(context),
  ].toSorted(
    (a, b) =>
      a.entityType.localeCompare(b.entityType) ||
      a.sourceId - b.sourceId ||
      (a.targetId ?? Number.POSITIVE_INFINITY) - (b.targetId ?? Number.POSITIVE_INFINITY),
  );
  applyManyToOneClassification(candidates);
  const discovery = {
    baseOsmId: base.id,
    patchOsmId: patch.id,
    options: resolved,
    candidates,
    summary: summarizeConflationCandidates(candidates),
  };
  refreshConflationWayRemovalAssessments(base, patch, discovery, options.decisions ?? []);
  return discovery;
}

function assertSelectedRemovalEligible(
  candidate: OsmConflationCandidate,
  decision: OsmConflationDecision | undefined,
  assessment = candidate.wayRemoval,
) {
  if (decision?.action !== "accept" || decision.removeWay !== true) return;
  if (assessment?.status !== "review" || !assessment.preview) {
    throw Error(
      `Cannot remove imported ${candidate.entityType} ${candidate.sourceId}: ${assessment?.reasons.join(", ") || "explicit way removal is not enabled or supported"}. Keep the imported geometry, or clear its removal choice before changing required connections.`,
    );
  }
}

/** Refresh detached removal plans atomically while preserving trusted candidate identities. @internal */
export function refreshConflationWayRemovalAssessments(
  base: Osm,
  patch: Osm,
  discovery: OsmConflationDiscovery,
  decisions: readonly OsmConflationDecision[],
  requireSelectedEligible = false,
): void {
  if (!discovery.options.allowWayRemoval) {
    if (requireSelectedEligible) {
      const byId = validatedDecisionMap(discovery.candidates, decisions);
      for (const candidate of discovery.candidates)
        assertSelectedRemovalEligible(candidate, byId.get(candidate.id));
    }
    return;
  }
  const byId = validatedDecisionMap(discovery.candidates, decisions);
  const assessments = assessWayRemovals(base, patch, discovery, byId, resolveConflationActions);
  if (requireSelectedEligible)
    for (const candidate of discovery.candidates)
      assertSelectedRemovalEligible(
        candidate,
        byId.get(candidate.id),
        assessments.get(candidate.id),
      );
  for (const candidate of discovery.candidates) {
    const assessment = assessments.get(candidate.id);
    if (!assessment) continue;
    candidate.wayRemoval = assessment;
    if (candidate.targetId == null) continue;
    const actions = [
      assessment,
      ...(discovery.options.propertyKeys.length ? [candidate.propertyTransfer] : []),
    ];
    candidate.status = actions.some((item) => item.status === "review")
      ? "review"
      : actions.some((item) => item.status === "automatic")
        ? "automatic"
        : "blocked";
    candidate.reasons = uniqueReasons(actions.flatMap((item) => item.reasons));
  }
  discovery.summary = summarizeConflationCandidates(discovery.candidates);
}

function validatedDecisionMap(
  candidates: readonly OsmConflationCandidate[],
  decisions: readonly OsmConflationDecision[],
) {
  if (!Array.isArray(decisions)) throw Error("Conflation decisions must be an array");
  if (decisions.length === 0) return new Map<string, OsmConflationDecision>();
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const result = new Map<string, OsmConflationDecision>();
  for (const decision of decisions) {
    if (decision == null || typeof decision !== "object") {
      throw Error("Conflation decision must be an object");
    }
    if (typeof decision.candidateId !== "string" || !candidateIds.has(decision.candidateId)) {
      throw Error(`Unknown conflation candidate: ${String(decision.candidateId)}`);
    }
    if (result.has(decision.candidateId)) {
      throw Error(`Duplicate conflation decision for ${decision.candidateId}`);
    }
    if (decision.action !== "accept" && decision.action !== "reject") {
      throw Error(`Invalid conflation decision action for ${decision.candidateId}`);
    }
    if (
      decision.transferProperties !== undefined &&
      typeof decision.transferProperties !== "boolean"
    ) {
      throw Error(`Conflation transferProperties must be a boolean for ${decision.candidateId}`);
    }
    if (decision.attachNetwork !== undefined && typeof decision.attachNetwork !== "boolean") {
      throw Error(`Conflation attachNetwork must be a boolean for ${decision.candidateId}`);
    }
    if (decision.removeWay !== undefined && typeof decision.removeWay !== "boolean") {
      throw Error(`Conflation removeWay must be a boolean for ${decision.candidateId}`);
    }
    result.set(decision.candidateId, decision);
  }
  return result;
}

function effectiveStatusForDecision(
  candidate: OsmConflationCandidate,
  decision: OsmConflationDecision | undefined,
): OsmConflationEffectiveStatus {
  if (decision?.action === "reject") return "rejected";
  if (decision?.action === "accept") {
    const actions = resolveConflationActions(candidate, decision);
    if (actions.transferProperties || actions.attachNetwork || actions.removeWay) {
      return "accepted";
    }
    // A saved acceptance cannot make a blocked action applicable. Keep its
    // blocked/unmatched status visible in summaries, paging, and restored reviews.
    if (
      decision.transferProperties !== false ||
      decision.attachNetwork !== false ||
      decision.removeWay === true
    ) {
      return candidate.status === "unmatched" ? "unmatched" : "blocked";
    }
    return "rejected";
  }
  return candidate.status;
}

/** Recompute review counts after lightweight decisions without rerunning discovery. */
export function summarizeConflationCandidates(
  candidates: readonly OsmConflationCandidate[],
  decisions: readonly OsmConflationDecision[] = [],
): OsmConflationSummary {
  const decisionsById = validatedDecisionMap(candidates, decisions);
  const summary: OsmConflationSummary = {
    total: candidates.length,
    accepted: 0,
    automatic: 0,
    review: 0,
    blocked: 0,
    unmatched: 0,
    rejected: 0,
  };
  for (const candidate of candidates) {
    const status = effectiveStatusForDecision(candidate, decisionsById.get(candidate.id));
    summary[status]++;
  }
  return summary;
}

function currentEntity<T extends "node" | "way" | "relation">(
  changeset: OsmChangeset,
  type: T,
  id: number,
) {
  const change = changeset.changes(type)[id];
  if (change?.changeType === "delete") return null;
  return change?.entity ?? changeset.getEntity(type, id) ?? null;
}

function acceptedAction(
  candidate: OsmConflationCandidate,
  action: "propertyTransfer" | "networkAttachment",
  decision: OsmConflationDecision | undefined,
) {
  if (decision?.action === "reject") return false;
  const assessment = candidate[action];
  // Manual review can select among reviewable actions, but it cannot override a
  // blocked invariant or manufacture a match for an unmatched candidate.
  if (!assessment || assessment.status === "blocked" || assessment.status === "unmatched")
    return false;
  const selected =
    action === "propertyTransfer" ? decision?.transferProperties : decision?.attachNetwork;
  if (decision?.action === "accept") return selected ?? true;
  return assessment.status === "automatic";
}

/** Resolve scheduled actions without changing discovery eligibility or overriding hard blockers. */
export function resolveConflationActions(
  candidate: OsmConflationCandidate,
  decision?: OsmConflationDecision,
): OsmConflationResolvedActions {
  return {
    transferProperties: acceptedAction(candidate, "propertyTransfer", decision),
    attachNetwork: acceptedAction(candidate, "networkAttachment", decision),
    ...(decision?.action === "accept" &&
    decision.removeWay === true &&
    candidate.wayRemoval?.status === "review"
      ? { removeWay: true }
      : {}),
  };
}

function transferSelectedProperties(
  changeset: OsmChangeset,
  candidate: OsmConflationCandidate,
  source: OsmEntity,
  trace: ConflationApplicationTrace,
) {
  if (candidate.targetId == null) return;
  const type = candidate.entityType;
  changeset.modify(type, candidate.targetId, (target) => {
    const tags = { ...target.tags };
    for (const diff of candidate.evidence.tagDiff) {
      if (diff.protected) continue;
      const value = source.tags![diff.key]!;
      if (tags[diff.key] === value) {
        trace.alreadyEqualTagValues.add(conflationTagSourceKey(candidate, diff.key));
        continue;
      }
      tags[diff.key] = value;
      trace.tagWriters.set(conflationTagTargetKey(candidate, diff.key), candidate.id);
    }
    return { ...target, tags };
  });
}

function findDecisionConflict(
  candidates: readonly OsmConflationCandidate[],
  decisions: ReadonlyMap<string, OsmConflationDecision>,
  preservedSourceConflicts?: ReadonlySet<string>,
): OsmConflationDecisionConflict | null {
  const scheduledSources = new Set<string>();
  for (const candidate of candidates) {
    const actions = resolveConflationActions(candidate, decisions.get(candidate.id));
    if (!actions.transferProperties && !actions.attachNetwork && !actions.removeWay) continue;
    const sourceKey = `${candidate.entityType}:${candidate.sourceId}`;
    if (preservedSourceConflicts?.has(sourceKey)) continue;
    if (!scheduledSources.has(sourceKey)) {
      scheduledSources.add(sourceKey);
      continue;
    }
    const { entityType, sourceId } = candidate;
    const candidateIds = candidates
      .filter((alternative) => {
        if (alternative.entityType !== entityType || alternative.sourceId !== sourceId)
          return false;
        const selected = resolveConflationActions(alternative, decisions.get(alternative.id));
        return selected.transferProperties || selected.attachNetwork || selected.removeWay;
      })
      .map((alternative) => alternative.id)
      .toSorted();
    return {
      entityType,
      sourceId,
      candidateIds,
      message: `Multiple targets are scheduled for imported ${entityType} ${sourceId}: ${candidateIds.join(", ")}. Choose one target or skip this imported feature.`,
    };
  }
  return null;
}

function validateAcceptedMappings(
  candidates: readonly OsmConflationCandidate[],
  decisions: ReadonlyMap<string, OsmConflationDecision>,
  preservedSourceConflicts?: ReadonlySet<string>,
) {
  const conflict = findDecisionConflict(candidates, decisions, preservedSourceConflicts);
  if (conflict) throw Object.assign(Error(conflict.message), { conflict });
  const attachmentTargets = new Set<number>();
  const wayTargets = new Set<number>();
  for (const candidate of candidates) {
    const decision = decisions.get(candidate.id);
    const {
      transferProperties: transfer,
      attachNetwork: attach,
      removeWay,
    } = resolveConflationActions(candidate, decision);
    if (!transfer && !attach && !removeWay) continue;
    if (candidate.targetId == null)
      throw Error(`Conflation accepted unmatched candidate ${candidate.id}`);
    if (attach) {
      if (attachmentTargets.has(candidate.targetId)) {
        throw Error(`Conflation accepted multiple node attachments to ${candidate.targetId}`);
      }
      attachmentTargets.add(candidate.targetId);
    }
    if (candidate.entityType === "way" && (transfer || removeWay)) {
      if (wayTargets.has(candidate.targetId)) {
        throw Error(`Conflation accepted multiple ways for target ${candidate.targetId}`);
      }
      wayTargets.add(candidate.targetId);
    }
  }
}

/** Cancel a pending import or delete an entity already present in the application baseline. */
export function removeImportedEntity(changeset: OsmChangeset, entity: OsmNode | OsmWay) {
  const type = "refs" in entity ? "way" : "node";
  const wasCreated = changeset.changes(type)[entity.id]?.changeType === "create";
  // Use delete to invalidate geometry/incidence caches before cancelling a create.
  changeset.delete(entity);
  if (wasCreated) delete changeset.changes(type)[entity.id];
}

/**
 * Drop each connected imported node the rewrite left unused (MP-M2): untagged and referenced by
 * no remaining way or relation. Tagged points stay, so uncopied values are never lost.
 */
function removeConnectionOrphans(
  changeset: OsmChangeset,
  base: Osm,
  patch: Osm,
  attachments: ReadonlyMap<number, number>,
  trace: ConflationApplicationTrace,
) {
  if (attachments.size === 0) return;
  const provenance = inputProvenance(base, patch);
  const relationNodeMembers = new Set<number>();
  for (const patchRelation of patch.relations) {
    const relation = currentEntity(changeset, "relation", patchRelation.id);
    for (const member of relation?.members ?? [])
      if (member.type === "node") relationNodeMembers.add(member.ref);
  }
  const patchWaysByNode = new Map<number, number[]>();
  for (const way of patch.ways)
    for (const ref of new Set(way.refs))
      if (attachments.has(ref))
        patchWaysByNode.set(ref, [...(patchWaysByNode.get(ref) ?? []), way.id]);
  for (const sourceId of attachments.keys()) {
    const node = currentEntity(changeset, "node", sourceId);
    // Only patch ways can reference an imported node; check their current refs.
    const byWay = (patchWaysByNode.get(sourceId) ?? []).some((wayId) =>
      currentEntity(changeset, "way", wayId)?.refs.includes(sourceId),
    );
    if (!node) continue;
    const droppable = canDropReplacedNode({
      imported: provenance.isImported("node", sourceId),
      tagged: Object.keys(node.tags ?? {}).length > 0,
      tagsMerged: false,
      referencedByWay: byWay,
      referencedByRelation: relationNodeMembers.has(sourceId),
    });
    if (!droppable) continue;
    removeImportedEntity(changeset, node);
    trace.connectionOrphanNodeIds.add(sourceId);
  }
}

function applyDiscoveredConflation(
  changeset: OsmChangeset,
  originalBase: Osm,
  patch: Osm,
  discovery: OsmConflationDiscovery,
  decisions: readonly OsmConflationDecision[],
) {
  if (patch.id !== discovery.patchOsmId) {
    throw Error(`Conflation discovery patch ${discovery.patchOsmId} does not match ${patch.id}`);
  }
  refreshConflationWayRemovalAssessments(originalBase, patch, discovery, decisions, true);
  const decisionsById = validatedDecisionMap(discovery.candidates, decisions);
  validateAcceptedMappings(discovery.candidates, decisionsById);

  const trace: ConflationApplicationTrace = {
    tagWriters: new Map(),
    alreadyEqualTagValues: new Set(),
    connectionOrphanNodeIds: new Set(),
  };
  const attachments = new Map<number, number>();
  const patchWayIds = new Set<number>();
  for (const candidate of discovery.candidates) {
    const decision = decisionsById.get(candidate.id);
    if (
      !resolveConflationActions(candidate, decision).attachNetwork ||
      candidate.targetId == null
    ) {
      continue;
    }
    attachments.set(candidate.sourceId, candidate.targetId);
    for (const wayId of candidate.evidence.patchWayIds ?? []) patchWayIds.add(wayId);
  }
  for (const wayId of patchWayIds) {
    // Only patch-created ways are listed in attachment evidence. Base way refs are
    // never rewritten, even when the nearby patch node is accepted.
    const way = currentEntity(changeset, "way", wayId);
    if (!way) continue;
    const refs = way.refs.map((ref) => attachments.get(ref) ?? ref);
    if (hasAdjacentDuplicateRefs(refs)) {
      throw Error(`Conflation attachment would create duplicate adjacent refs in way ${wayId}`);
    }
    if (way.tags?.["highway"] != null && hasTooFewDistinctRefs(refs)) {
      throw Error(`Conflation attachment would collapse highway way ${wayId}`);
    }
    changeset.modify("way", wayId, (current) => ({ ...current, refs }));
  }
  // Relation node members follow the connection (restrictions were checked in discovery).
  for (const patchRelation of patch.relations) {
    const relation = currentEntity(changeset, "relation", patchRelation.id);
    if (!relation?.members.some((member) => member.type === "node" && attachments.has(member.ref)))
      continue;
    changeset.modify("relation", relation.id, (current) => ({
      ...current,
      members: current.members.map((member) =>
        member.type === "node" && attachments.has(member.ref)
          ? { ...member, ref: attachments.get(member.ref)! }
          : member,
      ),
    }));
  }

  for (const candidate of discovery.candidates) {
    const decision = decisionsById.get(candidate.id);
    if (
      !resolveConflationActions(candidate, decision).transferProperties ||
      candidate.targetId == null
    ) {
      continue;
    }
    const source =
      candidate.entityType === "node"
        ? patch.nodes.getById(candidate.sourceId)
        : patch.ways.getById(candidate.sourceId);
    if (!source)
      throw Error(`Conflation source ${candidate.entityType} ${candidate.sourceId} is missing`);
    transferSelectedProperties(changeset, candidate, source, trace);
  }
  const selectedRemovals = discovery.candidates.filter(
    (candidate) =>
      decisionsById.get(candidate.id)?.action === "accept" &&
      decisionsById.get(candidate.id)?.removeWay === true,
  );
  if (selectedRemovals.length) {
    // Recheck the current state: the ordinary merge plus all accepted copy/connection
    // changes. Validate every removal before deleting anything, so dependent removals cannot
    // bypass checks.
    const current = changeset.overlay.reader();
    const assessments = assessWayRemovals(
      originalBase,
      patch,
      discovery,
      decisionsById,
      resolveConflationActions,
      current,
    );
    for (const candidate of selectedRemovals)
      assertSelectedRemovalEligible(
        candidate,
        decisionsById.get(candidate.id),
        assessments.get(candidate.id),
      );
    trace.wayRemovals = new Map();
    for (const candidate of selectedRemovals) {
      const preview = assessments.get(candidate.id)?.preview;
      if (!preview) throw Error(`Missing validated removal preview for ${candidate.id}`);
      const source = current.ways.getById(preview.sourceWayId);
      if (!source) throw Error(`Imported way ${preview.sourceWayId} is no longer present`);
      removeImportedEntity(changeset, source);
      for (const id of preview.orphanNodeIds) {
        const node = current.nodes.getById(id);
        if (node) removeImportedEntity(changeset, node);
      }
      trace.wayRemovals.set(candidate.id, preview);
    }
  }
  // Last, so removal checks see the imported geometry they were reviewed against.
  removeConnectionOrphans(changeset, originalBase, patch, attachments, trace);
  return trace;
}

/**
 * @internal Apply matching decisions to a merge plan's changes, in place, and report what
 * they did against the plan's state before matching.
 */
export function applyPlannedConflation(
  changeset: OsmChangeset,
  base: Osm,
  planned: Osm,
  discovery: OsmConflationDiscovery,
  decisions: readonly OsmConflationDecision[],
  /** The planned state now, read-only, when the caller holds one; otherwise a copy. */
  current?: PlanOverlay,
) {
  const snapshot = current ?? changeset.overlay.snapshot();
  const before = snapshot.reader();
  const trace = applyDiscoveredConflation(changeset, base, planned, discovery, decisions);
  const after = changeset.overlay.reader();
  assertConflationPreservesBaseTopology(base, snapshot, changeset.overlay);
  return createConflationOutcomeReport(
    base,
    planned,
    before,
    after,
    discovery,
    decisions,
    trace,
    resolveConflationActions,
  );
}
