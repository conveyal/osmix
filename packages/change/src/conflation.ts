/** Safe, explicit proximity conflation for imported OSM-like datasets. */

import type { Osm } from "@osmix/core";
import { haversineDistance } from "@osmix/geo/haversine-distance";
import type { LonLat, OsmEntity, OsmNode, OsmRelation, OsmTags, OsmWay } from "@osmix/types";

import { applyChangesetToOsm } from "./apply-changeset.ts";
import { OsmChangeset } from "./changeset.ts";
import { generateChangeset } from "./generate-changeset.ts";
import { assertConflationPreservesBaseTopology } from "./integrity.ts";
import type {
  OsmConflationActionAssessment,
  OsmConflationCandidate,
  OsmConflationCandidateFilter,
  OsmConflationDecision,
  OsmConflationDiscovery,
  OsmConflationEffectiveStatus,
  OsmConflationEvidence,
  OsmConflationOptions,
  OsmConflationReasonCode,
  OsmConflationRoutingFamily,
  OsmConflationSummary,
  OsmConflationTagDiff,
  OsmMergeOptions,
  ResolvedOsmConflationOptions,
} from "./types.ts";
import { routingGradeSignature } from "./utils.ts";

// Preserve the historical one-meter matching radius, but only inside this explicit,
// cross-dataset workflow. Proximity alone never authorizes a topology change.
const DEFAULT_MAX_DISTANCE_METERS = 1;
const MAX_BEARING_DIFFERENCE_DEGREES = 30;
const MAX_LENGTH_DIFFERENCE_RATIO = 0.05;
const SAMPLE_INTERVAL_METERS = 5;

const PEDESTRIAN_HIGHWAYS = new Set(["corridor", "footway", "path", "pedestrian", "steps"]);
const BICYCLE_HIGHWAYS = new Set(["cycleway"]);
const NON_MOTOR_HIGHWAYS = new Set([...PEDESTRIAN_HIGHWAYS, ...BICYCLE_HIGHWAYS, "bridleway"]);
// Access and routing checks also recognize namespaced variants (for example
// `access:conditional` and `maxspeed:forward`) so they cannot bypass review.
const ACCESS_KEYS = [
  "access",
  "agricultural",
  "atv",
  "bicycle",
  "bus",
  "caravan",
  "carriage",
  "coach",
  "emergency",
  "foot",
  "forestry",
  "golf_cart",
  "goods",
  "horse",
  "hgv",
  "hgv_articulated",
  "hov",
  "inline_skates",
  "mofa",
  "moped",
  "motorcycle",
  "motor_vehicle",
  "motorcar",
  "motorhome",
  "psv",
  "ski",
  "snowmobile",
  "taxi",
  "tourist_bus",
  "trailer",
  "vehicle",
  "wheelchair",
] as const;
const PROTECTED_KEYS = new Set([
  "area",
  "bridge",
  "covered",
  "layer",
  "level",
  "restriction",
  "tunnel",
  "type",
]);
const ROUTING_KEYS = new Set([
  ...ACCESS_KEYS,
  "barrier",
  "crossing",
  "highway",
  "junction",
  "kerb",
  "maxspeed",
  "oneway",
]);

type EntityRelationContext = {
  nodes: Set<number>;
  ways: Set<number>;
  restrictionNodes: Set<number>;
  restrictionWays: Set<number>;
};

type DiscoveryContext = {
  base: Osm;
  patch: Osm;
  options: ResolvedOsmConflationOptions;
  baseWaysByNode: Map<number, OsmWay[]>;
  patchWaysByNode: Map<number, OsmWay[]>;
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
  if (options.automatic != null && !["high-confidence", "none"].includes(options.automatic)) {
    throw Error("Conflation automatic must be high-confidence or none");
  }
  const maxDistanceMeters = options.maxDistanceMeters ?? DEFAULT_MAX_DISTANCE_METERS;
  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0) {
    throw Error("Conflation maxDistanceMeters must be a positive finite number");
  }
  const propertyKeys = [...new Set(options.propertyKeys)].toSorted();
  if (propertyKeys.length === 0 && !options.attachNetwork) {
    throw Error("Conflation requires at least one property key or network attachment");
  }
  return {
    propertyKeys,
    attachNetwork: options.attachNetwork,
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

function waysByNode(osm: Osm) {
  const result = new Map<number, OsmWay[]>();
  for (const way of osm.ways) {
    for (const ref of new Set(way.refs)) {
      const ways = result.get(ref) ?? [];
      ways.push(way);
      result.set(ref, ways);
    }
  }
  return result;
}

function relationContext(osm: Osm): EntityRelationContext {
  const context: EntityRelationContext = {
    nodes: new Set(),
    ways: new Set(),
    restrictionNodes: new Set(),
    restrictionWays: new Set(),
  };
  for (const relation of osm.relations) {
    const restriction = relation.tags?.["type"] === "restriction";
    for (const member of relation.members) {
      if (member.type === "node") {
        context.nodes.add(member.ref);
        if (restriction) context.restrictionNodes.add(member.ref);
      } else if (member.type === "way") {
        context.ways.add(member.ref);
        if (restriction) context.restrictionWays.add(member.ref);
      }
    }
  }
  return context;
}

function isAreaWay(way: OsmWay) {
  if (String(way.tags?.["area"] ?? "") === "yes") return true;
  if (way.refs.length < 4 || way.refs[0] !== way.refs.at(-1)) return false;
  return ["building", "landuse", "natural", "boundary"].some((key) => way.tags?.[key] != null);
}

function wayRoutingFamily(way: OsmWay): OsmConflationRoutingFamily {
  const highway = String(way.tags?.["highway"] ?? "");
  if (!highway || isAreaWay(way)) return "non-routable";
  if (
    BICYCLE_HIGHWAYS.has(highway) ||
    (highway === "path" && !["no", "private"].includes(String(way.tags?.["bicycle"] ?? "")))
  ) {
    return "bicycle-shared";
  }
  if (PEDESTRIAN_HIGHWAYS.has(highway)) return "pedestrian";
  // Unknown highway values stay in the motor family. Treating a potentially
  // drivable way as non-routable would make an unsafe attachment look harmless.
  if (!NON_MOTOR_HIGHWAYS.has(highway)) return "motor-road";
  return "non-routable";
}

function routingFamilies(ways: readonly OsmWay[]) {
  const families = new Set(ways.map(wayRoutingFamily));
  if (families.size > 1) families.delete("non-routable");
  return [...families].toSorted() as OsmConflationRoutingFamily[];
}

function familyCompatible(a: OsmConflationRoutingFamily, b: OsmConflationRoutingFamily) {
  if (a === b) return true;
  return (
    (a === "pedestrian" && b === "bicycle-shared") || (a === "bicycle-shared" && b === "pedestrian")
  );
}

function accessSignature(tags: OsmTags | undefined) {
  return Object.keys(tags ?? {})
    .filter((key) =>
      ACCESS_KEYS.some((accessKey) => key === accessKey || key.startsWith(`${accessKey}:`)),
    )
    .toSorted()
    .map((key) => `${key}=${String(tags?.[key] ?? "")}`)
    .join("|");
}

// These signatures intentionally compare both presence and value. Rewriting a
// patch reference must not strand node-level routing semantics on the discarded node.
function barrierSignature(tags: OsmTags | undefined) {
  return Object.keys(tags ?? {})
    .filter((key) => key === "barrier" || key.startsWith("barrier:"))
    .toSorted()
    .map((key) => `${key}=${String(tags?.[key] ?? "")}`)
    .join("|");
}

function nodeRoutingSignature(tags: OsmTags | undefined) {
  return Object.keys(tags ?? {})
    .filter(
      (key) =>
        isRoutingProperty(key) &&
        !ACCESS_KEYS.some((accessKey) => key === accessKey || key.startsWith(`${accessKey}:`)) &&
        key !== "barrier" &&
        !key.startsWith("barrier:"),
    )
    .toSorted()
    .map((key) => `${key}=${String(tags?.[key] ?? "")}`)
    .join("|");
}

function wayContextsCompatible(source: OsmWay, target: OsmWay) {
  return (
    familyCompatible(wayRoutingFamily(source), wayRoutingFamily(target)) &&
    wayGradeAccessCompatible(source, target)
  );
}

function wayGradeAccessCompatible(source: OsmWay, target: OsmWay) {
  return (
    routingGradeSignature(source.tags) === routingGradeSignature(target.tags) &&
    accessSignature(source.tags) === accessSignature(target.tags)
  );
}

function normalizedOneway(way: OsmWay) {
  const value = String(way.tags?.["oneway"] ?? "").toLowerCase();
  if (["yes", "true", "1"].includes(value)) return "forward";
  if (["-1", "reverse"].includes(value)) return "reverse";
  if (String(way.tags?.["junction"] ?? "") === "roundabout" && value !== "no") {
    return "forward";
  }
  return "both";
}

function reversedOneway(value: ReturnType<typeof normalizedOneway>) {
  return value === "forward" ? "reverse" : value === "reverse" ? "forward" : value;
}

function wayRoutingSemanticsCompatible(source: OsmWay, target: OsmWay, targetReversed: boolean) {
  const targetOneway = normalizedOneway(target);
  if (normalizedOneway(source) !== (targetReversed ? reversedOneway(targetOneway) : targetOneway)) {
    return false;
  }
  const routingKeys = new Set(
    [...Object.keys(source.tags ?? {}), ...Object.keys(target.tags ?? {})].filter(
      (key) => isRoutingProperty(key) && key !== "oneway",
    ),
  );
  if (
    targetReversed &&
    // Reversed geometry is safe only when no remaining routing tag has a direction
    // whose meaning would also need to be inverted or swapped.
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

function isProtectedProperty(key: string) {
  return PROTECTED_KEYS.has(key) || key.startsWith("restriction:");
}

function isRoutingProperty(key: string) {
  return [...ROUTING_KEYS].some(
    (routingKey) => key === routingKey || key.startsWith(`${routingKey}:`),
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
  patchWays: readonly OsmWay[],
  baseWays: readonly OsmWay[],
  tagDiff: readonly OsmConflationTagDiff[],
) {
  const assessment = propertyAssessment(tagDiff, context.options);
  if (assessment.status === "blocked") return assessment;

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
    if (
      !patchRoutable.every((source) =>
        baseRoutable.some((target) => wayGradeAccessCompatible(source, target)),
      )
    ) {
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

function lineLength(coordinates: readonly LonLat[]) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index++) {
    total += haversineDistance(coordinates[index - 1]!, coordinates[index]!);
  }
  return total;
}

function interpolate(a: LonLat, b: LonLat, parameter: number): LonLat {
  return [a[0] + (b[0] - a[0]) * parameter, a[1] + (b[1] - a[1]) * parameter];
}

function sampleLine(coordinates: readonly LonLat[]) {
  if (coordinates.length <= 1) return [...coordinates];
  const result: LonLat[] = [coordinates[0]!];
  for (let index = 1; index < coordinates.length; index++) {
    const start = coordinates[index - 1]!;
    const end = coordinates[index]!;
    const length = haversineDistance(start, end);
    const samples = Math.floor(length / SAMPLE_INTERVAL_METERS);
    for (let sample = 1; sample <= samples; sample++) {
      const distance = sample * SAMPLE_INTERVAL_METERS;
      if (distance >= length) break;
      result.push(interpolate(start, end, distance / length));
    }
    result.push(end);
  }
  return result;
}

function pointSegmentDistance(point: LonLat, start: LonLat, end: LonLat) {
  const latitudeRadians = (point[1] * Math.PI) / 180;
  const xScale = 111_320 * Math.cos(latitudeRadians);
  const yScale = 110_574;
  const startX = (start[0] - point[0]) * xScale;
  const startY = (start[1] - point[1]) * yScale;
  const endX = (end[0] - point[0]) * xScale;
  const endY = (end[1] - point[1]) * yScale;
  const dx = endX - startX;
  const dy = endY - startY;
  const denominator = dx * dx + dy * dy;
  const parameter =
    denominator === 0 ? 0 : Math.max(0, Math.min(1, -(startX * dx + startY * dy) / denominator));
  return Math.hypot(startX + parameter * dx, startY + parameter * dy);
}

function pointLineDistance(point: LonLat, line: readonly LonLat[]) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index++) {
    minimum = Math.min(minimum, pointSegmentDistance(point, line[index - 1]!, line[index]!));
  }
  return minimum;
}

function symmetricLineDistance(a: readonly LonLat[], b: readonly LonLat[]) {
  let maximum = 0;
  for (const point of sampleLine(a)) maximum = Math.max(maximum, pointLineDistance(point, b));
  for (const point of sampleLine(b)) maximum = Math.max(maximum, pointLineDistance(point, a));
  return maximum;
}

function wayCoordinates(osm: Osm, way: OsmWay) {
  const index = osm.ways.ids.getIndexFromId(way.id);
  return index < 0 ? [] : osm.ways.getResolvedCoordinates(index);
}

function lineBbox(
  coordinates: readonly LonLat[],
  paddingMeters: number,
): [number, number, number, number] {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of coordinates) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  const middleLat = (minLat + maxLat) / 2;
  const latPadding = paddingMeters / 110_574;
  const lonPadding =
    paddingMeters / (111_320 * Math.max(0.01, Math.cos((middleLat * Math.PI) / 180)));
  return [minLon - lonPadding, minLat - latPadding, maxLon + lonPadding, maxLat + latPadding];
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

function nodeSegments(osm: Osm, nodeId: number, ways: readonly OsmWay[]) {
  const node = osm.nodes.getById(nodeId);
  if (!node) return [];
  const segments: { bearing: number; way: OsmWay }[] = [];
  for (const way of ways) {
    for (let index = 0; index < way.refs.length; index++) {
      if (way.refs[index] !== nodeId) continue;
      for (const neighborIndex of [index - 1, index + 1]) {
        const neighborId = way.refs[neighborIndex];
        if (neighborId == null || neighborId === nodeId) continue;
        const neighbor = osm.nodes.getById(neighborId);
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
    (way) => !context.base.ways.ids.has(way.id) && wayRoutingFamily(way) !== "non-routable",
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
  const hardReasons: OsmConflationReasonCode[] = [];
  const reviewReasons: OsmConflationReasonCode[] = [];
  if (routingGradeSignature(source.tags) !== routingGradeSignature(target.tags)) {
    hardReasons.push("grade-conflict");
  }
  if (accessSignature(source.tags) !== accessSignature(target.tags)) {
    hardReasons.push("routing-family-conflict");
  }
  const sourceBarrier = barrierSignature(source.tags);
  const targetBarrier = barrierSignature(target.tags);
  if (sourceBarrier !== targetBarrier) hardReasons.push("routing-family-conflict");
  else if (sourceBarrier !== "") reviewReasons.push("node-context-conflict");
  if (nodeRoutingSignature(source.tags) !== nodeRoutingSignature(target.tags)) {
    hardReasons.push("routing-family-conflict");
  }
  if (
    ["layer", "level", "bridge", "tunnel", "covered"].some(
      (key) => source.tags?.[key] != null || target.tags?.[key] != null,
    )
  ) {
    reviewReasons.push("node-context-conflict");
  }
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
  if (restrictionMember) hardReasons.push("relation-member");
  else if (relationMember) reviewReasons.push("relation-member");

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

  const gradeCompatible = sourceWays.every((sourceWay) =>
    targetWays.some(
      (targetWay) =>
        routingGradeSignature(sourceWay.tags) === routingGradeSignature(targetWay.tags) &&
        accessSignature(sourceWay.tags) === accessSignature(targetWay.tags),
    ),
  );
  if (!gradeCompatible) hardReasons.push("grade-conflict");

  const sourceSegments = nodeSegments(context.patch, source.id, sourceWays);
  const targetSegments = nodeSegments(context.base, target.id, targetWays);
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

  for (const way of sourceWays) {
    const replacedRefs = way.refs.map((ref) => (ref === source.id ? target.id : ref));
    const adjacentDuplicate = replacedRefs.some(
      (ref, index) => index > 0 && ref === replacedRefs[index - 1],
    );
    if (adjacentDuplicate || new Set(replacedRefs).size < 2) hardReasons.push("would-collapse-way");
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
    if (!assessment || assessment.status === "blocked" || assessment.status === "unmatched") {
      continue;
    }
    if (assessment.status === "automatic") assessment.status = "review";
    assessment.reasons = uniqueReasons([...assessment.reasons, reason]);
  }
  candidate.reasons = uniqueReasons([...candidate.reasons, reason]);
  if (candidate.status === "automatic") candidate.status = "review";
}

function discoverNodeCandidates(context: DiscoveryContext) {
  const candidates: OsmConflationCandidate[] = [];
  for (const source of context.patch.nodes.sorted()) {
    // Same-ID entities belong to ordinary merge semantics; fuzzy matching must not
    // reinterpret an authoritative patch update.
    if (context.base.nodes.ids.has(source.id)) continue;
    const patchWays = context.patchWaysByNode.get(source.id) ?? [];
    const eligible =
      context.options.propertyKeys.some((key) => source.tags?.[key] != null) ||
      (context.options.attachNetwork &&
        patchWays.some((way) => !context.base.ways.ids.has(way.id)));
    if (!eligible) continue;

    const nearby = context.base.nodes
      .findIndexesWithinRadius(source.lon, source.lat, context.options.maxDistanceMeters / 1_000)
      .map((index) => context.base.nodes.getByIndex(index));
    // A base ID also present in the patch is mutable under direct merge, so it is
    // not an immutable target for a different imported entity.
    const targets = nearby.filter((target) => !context.patch.nodes.ids.has(target.id));
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
      const baseWays = context.baseWaysByNode.get(target.id) ?? [];
      const tagDiff = selectedTagDiff(source, target, context.options.propertyKeys);
      const property = nodePropertyAssessment(context, patchWays, baseWays, tagDiff);
      const attachment = nodeAttachmentAssessment(context, source, target, patchWays, baseWays);
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
  return Math.max(...forward) <= Math.max(...reverse)
    ? { distances: forward, reversed: false }
    : { distances: reverse, reversed: true };
}

function discoverWayCandidates(context: DiscoveryContext) {
  const candidates: OsmConflationCandidate[] = [];
  if (context.options.propertyKeys.length === 0) return candidates;
  for (const source of context.patch.ways.sorted()) {
    if (context.base.ways.ids.has(source.id)) continue;
    if (!context.options.propertyKeys.some((key) => source.tags?.[key] != null)) continue;
    const sourceCoordinates = wayCoordinates(context.patch, source);
    if (sourceCoordinates.length < 2) continue;
    const nearbyIndexes = context.base.ways.intersects(
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
      >;
    }[] = [];
    for (const index of nearbyIndexes) {
      const target = context.base.ways.getByIndex(index);
      if (context.patch.ways.ids.has(target.id)) continue;
      const targetCoordinates = wayCoordinates(context.base, target);
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
        },
      });
    }

    if (matches.length === 0) {
      // Multiple nearby base ways may represent a segmented equivalent. This version
      // deliberately reports that case instead of guessing a one-to-many mapping.
      const reasons: OsmConflationReasonCode[] =
        nearbyIndexes.length > 1 ? ["unsupported-way-chain"] : [];
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
        property.status = restriction ? "blocked" : "review";
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
  const resolved = resolvedOptions(options);
  const context: DiscoveryContext = {
    base,
    patch,
    options: resolved,
    baseWaysByNode: waysByNode(base),
    patchWaysByNode: waysByNode(patch),
    baseRelations: relationContext(base),
    patchRelations: relationContext(patch),
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
  return {
    baseOsmId: base.id,
    patchOsmId: patch.id,
    options: resolved,
    candidates,
    summary: summarizeConflationCandidates(candidates),
  };
}

function decisionMap(decisions: readonly OsmConflationDecision[]) {
  return new Map(decisions.map((decision) => [decision.candidateId, decision]));
}

function validatedDecisionMap(
  candidates: readonly OsmConflationCandidate[],
  decisions: readonly OsmConflationDecision[],
) {
  if (!Array.isArray(decisions)) throw Error("Conflation decisions must be an array");
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
    result.set(decision.candidateId, decision);
  }
  return result;
}

/** Validate review decisions against canonical candidates without mutating either input. */
export function validateConflationDecisions(
  candidates: readonly OsmConflationCandidate[],
  decisions: readonly OsmConflationDecision[],
) {
  validatedDecisionMap(candidates, decisions);
}

/** Return a candidate's effective status without rerunning spatial discovery. */
export function conflationEffectiveStatus(
  candidate: OsmConflationCandidate,
  decisions: readonly OsmConflationDecision[] = [],
): OsmConflationEffectiveStatus {
  return decisionMap(decisions).get(candidate.id)?.action === "reject"
    ? "rejected"
    : candidate.status;
}

/** Recompute review counts after lightweight decisions without rerunning discovery. */
export function summarizeConflationCandidates(
  candidates: readonly OsmConflationCandidate[],
  decisions: readonly OsmConflationDecision[] = [],
): OsmConflationSummary {
  const summary: OsmConflationSummary = {
    total: candidates.length,
    automatic: 0,
    review: 0,
    blocked: 0,
    unmatched: 0,
    rejected: 0,
  };
  const decisionsById = validatedDecisionMap(candidates, decisions);
  for (const candidate of candidates) {
    if (decisionsById.get(candidate.id)?.action === "reject") summary.rejected++;
    else summary[candidate.status]++;
  }
  return summary;
}

/** Filter candidate rows deterministically, including effective rejected status. */
export function filterConflationCandidates(
  candidates: readonly OsmConflationCandidate[],
  filter: OsmConflationCandidateFilter,
  decisions: readonly OsmConflationDecision[] = [],
) {
  return candidates.filter((candidate) => {
    if (filter.entityType != null && candidate.entityType !== filter.entityType) return false;
    if (
      filter.status != null &&
      conflationEffectiveStatus(candidate, decisions) !== filter.status
    ) {
      return false;
    }
    if (filter.reason != null && !candidate.reasons.includes(filter.reason)) return false;
    if (filter.sourceId != null && candidate.sourceId !== filter.sourceId) return false;
    if ("targetId" in filter && candidate.targetId !== filter.targetId) return false;
    return true;
  });
}

function currentEntity<T extends "node" | "way">(changeset: OsmChangeset, type: T, id: number) {
  const change = changeset.changes(type)[id];
  if (change?.changeType === "delete") return null;
  return change?.entity ?? changeset.getEntity(type, id) ?? null;
}

function currentRelations(changeset: OsmChangeset) {
  const relations = new Map<number, OsmRelation>();
  for (const relation of changeset.osm.relations) {
    const change = changeset.relationChanges[relation.id];
    if (change?.changeType !== "delete") relations.set(relation.id, change?.entity ?? relation);
  }
  for (const change of Object.values(changeset.relationChanges)) {
    if (change.changeType === "delete") relations.delete(change.entity.id);
    else relations.set(change.entity.id, change.entity);
  }
  return relations.values();
}

function currentWays(changeset: OsmChangeset) {
  const ways = new Map<number, OsmWay>();
  for (const way of changeset.osm.ways) {
    const change = changeset.wayChanges[way.id];
    if (change?.changeType !== "delete") ways.set(way.id, change?.entity ?? way);
  }
  for (const change of Object.values(changeset.wayChanges)) {
    if (change.changeType === "delete") ways.delete(change.entity.id);
    else ways.set(change.entity.id, change.entity);
  }
  return ways.values();
}

function removeCurrentEntity(changeset: OsmChangeset, entity: OsmEntity) {
  const type = "lon" in entity ? "node" : "refs" in entity ? "way" : "relation";
  const change = changeset.changes(type)[entity.id];
  if (change?.changeType === "create") delete changeset.changes(type)[entity.id];
  else changeset.delete(entity);
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

function transferSelectedProperties(
  changeset: OsmChangeset,
  candidate: OsmConflationCandidate,
  source: OsmEntity,
) {
  if (candidate.targetId == null) return;
  const type = candidate.entityType;
  changeset.modify(type, candidate.targetId, (target) => {
    const tags = { ...target.tags };
    for (const diff of candidate.evidence.tagDiff) {
      if (diff.protected) continue;
      tags[diff.key] = source.tags![diff.key]!;
    }
    return { ...target, tags };
  });
}

function validateAcceptedMappings(
  candidates: readonly OsmConflationCandidate[],
  decisions: ReadonlyMap<string, OsmConflationDecision>,
) {
  const sourceActions = new Set<string>();
  const attachmentTargets = new Set<number>();
  const wayTargets = new Set<number>();
  for (const candidate of candidates) {
    const decision = decisions.get(candidate.id);
    const transfer = acceptedAction(candidate, "propertyTransfer", decision);
    const attach = acceptedAction(candidate, "networkAttachment", decision);
    if (!transfer && !attach) continue;
    const sourceKey = `${candidate.entityType}:${candidate.sourceId}`;
    if (sourceActions.has(sourceKey)) {
      throw Error(`Conflation accepted multiple targets for ${sourceKey}`);
    }
    sourceActions.add(sourceKey);
    if (candidate.targetId == null)
      throw Error(`Conflation accepted unmatched candidate ${candidate.id}`);
    if (attach) {
      if (attachmentTargets.has(candidate.targetId)) {
        throw Error(`Conflation accepted multiple node attachments to ${candidate.targetId}`);
      }
      attachmentTargets.add(candidate.targetId);
    }
    if (candidate.entityType === "way" && transfer) {
      if (wayTargets.has(candidate.targetId)) {
        throw Error(`Conflation accepted multiple ways for target ${candidate.targetId}`);
      }
      wayTargets.add(candidate.targetId);
    }
  }
}

function cleanupUnreferencedPatchNodes(
  changeset: OsmChangeset,
  patch: Osm,
  originalBase: Osm,
  cleanupCandidateIds: ReadonlySet<number>,
) {
  // Cleanup is intentionally limited to nodes from a suppressed matched patch way.
  // Removing every orphan patch node would violate direct merge preservation.
  const referenced = new Set<number>();
  for (const way of currentWays(changeset)) for (const ref of way.refs) referenced.add(ref);
  for (const relation of currentRelations(changeset)) {
    for (const member of relation.members) if (member.type === "node") referenced.add(member.ref);
  }
  for (const nodeId of cleanupCandidateIds) {
    const node = patch.nodes.getById(nodeId);
    if (!node) continue;
    if (originalBase.nodes.ids.has(node.id) || node.tags != null || referenced.has(node.id))
      continue;
    const current = currentEntity(changeset, "node", node.id);
    if (current) removeCurrentEntity(changeset, current);
  }
}

function applyDiscoveredConflation(
  changeset: OsmChangeset,
  patch: Osm,
  discovery: OsmConflationDiscovery,
  decisions: readonly OsmConflationDecision[],
  originalBase: Osm,
) {
  if (patch.id !== discovery.patchOsmId) {
    throw Error(`Conflation discovery patch ${discovery.patchOsmId} does not match ${patch.id}`);
  }
  const decisionsById = validatedDecisionMap(discovery.candidates, decisions);
  validateAcceptedMappings(discovery.candidates, decisionsById);

  const attachments = new Map<number, number>();
  const patchWayIds = new Set<number>();
  const cleanupCandidateNodeIds = new Set<number>();
  for (const candidate of discovery.candidates) {
    const decision = decisionsById.get(candidate.id);
    if (!acceptedAction(candidate, "networkAttachment", decision) || candidate.targetId == null) {
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
    if (refs.some((ref, index) => index > 0 && ref === refs[index - 1])) {
      throw Error(`Conflation attachment would create duplicate adjacent refs in way ${wayId}`);
    }
    if (way.tags?.["highway"] != null && new Set(refs).size < 2) {
      throw Error(`Conflation attachment would collapse highway way ${wayId}`);
    }
    changeset.modify("way", wayId, (current) => ({ ...current, refs }));
  }

  for (const candidate of discovery.candidates) {
    const decision = decisionsById.get(candidate.id);
    if (!acceptedAction(candidate, "propertyTransfer", decision) || candidate.targetId == null) {
      continue;
    }
    const source =
      candidate.entityType === "node"
        ? patch.nodes.getById(candidate.sourceId)
        : patch.ways.getById(candidate.sourceId);
    if (!source)
      throw Error(`Conflation source ${candidate.entityType} ${candidate.sourceId} is missing`);
    transferSelectedProperties(changeset, candidate, source);
    if (
      candidate.entityType !== "way" ||
      candidate.reasons.includes("relation-member") ||
      candidate.reasons.includes("protected-tag")
    ) {
      continue;
    }
    const current = currentEntity(changeset, "way", candidate.sourceId);
    if (current) {
      // An equivalent one-to-one patch way is suppressed after property transfer.
      // Its nodes become cleanup candidates, not unconditional deletions.
      for (const ref of current.refs) cleanupCandidateNodeIds.add(ref);
      removeCurrentEntity(changeset, current);
    }
  }
  cleanupUnreferencedPatchNodes(changeset, patch, originalBase, cleanupCandidateNodeIds);
}

/** Generate fuzzy-only changes over an already applied ordinary direct/exact merge baseline. */
export function generateConflationApplicationChangeset(
  baseline: Osm,
  patch: Osm,
  discovery: OsmConflationDiscovery,
  originalBase: Osm,
  decisions: readonly OsmConflationDecision[] = [],
) {
  if (patch.id !== discovery.patchOsmId) {
    throw Error(`Conflation discovery patch ${discovery.patchOsmId} does not match ${patch.id}`);
  }
  if (originalBase.id !== discovery.baseOsmId) {
    throw Error(
      `Conflation discovery base ${discovery.baseOsmId} does not match ${originalBase.id}`,
    );
  }
  // Recompute from untouched entities before applying. Candidate records returned
  // to callers are review data, not trusted instructions for mutating topology.
  const canonicalDiscovery = discoverConflationCandidates(originalBase, patch, discovery.options);
  const changeset = new OsmChangeset(baseline);
  applyDiscoveredConflation(changeset, patch, canonicalDiscovery, decisions, originalBase);
  const result = applyChangesetToOsm(changeset);
  assertConflationPreservesBaseTopology(originalBase, baseline, result);
  return changeset;
}

/**
 * Generate a cumulative direct/exact/fuzzy changeset from untouched inputs.
 * Intersection creation remains a later stage because newly created ways are not indexed yet.
 */
export function generateConflationChangeset(
  base: Osm,
  patch: Osm,
  options: Partial<OsmMergeOptions>,
  decisions: readonly OsmConflationDecision[] = options.conflation?.decisions ?? [],
  discovery?: OsmConflationDiscovery,
) {
  if (!options.conflation) throw Error("generateConflationChangeset requires conflation options");
  if (!options.directMerge)
    throw Error("Fuzzy conflation requires directMerge to preserve unmatched patch entities");
  if (options.createIntersections) {
    throw Error(
      "generateConflationChangeset cannot create intersections in the cumulative changeset",
    );
  }
  // Generation never trusts possibly stale or caller-mutated candidate evidence.
  // Stable decisions are replayed against a fresh discovery from untouched inputs.
  const canonicalDiscovery = discoverConflationCandidates(base, patch, options.conflation);
  const suppliedDiscovery = discovery ?? canonicalDiscovery;
  if (suppliedDiscovery.baseOsmId !== base.id || suppliedDiscovery.patchOsmId !== patch.id) {
    throw Error("Conflation discovery does not match the untouched merge inputs");
  }
  const expectedOptions = resolvedOptions(options.conflation);
  if (
    suppliedDiscovery.options.attachNetwork !== expectedOptions.attachNetwork ||
    suppliedDiscovery.options.automatic !== expectedOptions.automatic ||
    suppliedDiscovery.options.maxDistanceMeters !== expectedOptions.maxDistanceMeters ||
    suppliedDiscovery.options.propertyKeys.length !== expectedOptions.propertyKeys.length ||
    suppliedDiscovery.options.propertyKeys.some(
      (key, index) => key !== expectedOptions.propertyKeys[index],
    )
  ) {
    throw Error("Conflation discovery options do not match generation options");
  }
  const ordinaryOptions = {
    directMerge: true,
    deduplicateNodes: options.deduplicateNodes ?? false,
    deduplicateWays: options.deduplicateWays ?? false,
    createIntersections: false,
  };
  // Compare fuzzy output with the ordinary merge, not the raw base. This preserves
  // authoritative same-ID patch updates while forbidding fuzzy geometry rewrites.
  const ordinaryBaseline = applyChangesetToOsm(generateChangeset(base, patch, ordinaryOptions));
  const changeset = generateChangeset(base, patch, ordinaryOptions);
  applyDiscoveredConflation(changeset, patch, canonicalDiscovery, decisions, base);
  const result = applyChangesetToOsm(changeset);
  assertConflationPreservesBaseTopology(base, ordinaryBaseline, result);
  return changeset;
}
