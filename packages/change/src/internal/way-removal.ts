/** Conservative, decision-dependent plans for explicit imported-way removal. */
import type { Osm } from "@osmix/core";
import { haversineDistance } from "@osmix/geo/haversine-distance";
import type { OsmNode, OsmTags, OsmWay } from "@osmix/types";
import { normalizedWayDirection } from "@osmix/types/way-direction";

import type {
  OsmConflationCandidate,
  OsmConflationDecision,
  OsmConflationDiscovery,
  OsmConflationReasonCode,
  OsmConflationResolvedActions,
  OsmConflationWayRemovalAssessment,
  OsmConflationWayRemovalPreview,
} from "../types.ts";

const DESCRIPTIVE_KEYS = new Set([
  "alt_name",
  "int_name",
  "loc_name",
  "name",
  "note",
  "official_name",
  "old_name",
  "operator",
  "ref",
  "short_name",
  "source",
  "wikidata",
  "wikipedia",
]);
const DESCRIPTIVE_PREFIXES = [
  "alt_name:",
  "name:",
  "note:",
  "official_name:",
  "old_name:",
  "operator:",
  "source:",
];
const MATCH_BLOCKERS = new Set<OsmConflationReasonCode>([
  "feature-type-conflict",
  "geometry-mismatch",
  "grade-conflict",
  "length-mismatch",
  "many-to-one",
  "multiple-targets",
  "routing-family-conflict",
  "unsupported-way-chain",
]);

function semanticTagsEqual(left: OsmTags | undefined, right: OsmTags | undefined, way: boolean) {
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  return [...keys].every((key) => {
    if (
      (way && key === "oneway") ||
      DESCRIPTIVE_KEYS.has(key) ||
      DESCRIPTIVE_PREFIXES.some((prefix) => key.startsWith(prefix))
    )
      return true;
    return String(left?.[key] ?? "") === String(right?.[key] ?? "");
  });
}

/** Values can be way-relative too: sidewalk=left and direction=forward change on reversal. */
function hasRelativeDirection(tags: OsmTags | undefined) {
  const relative = new Set(["forward", "backward", "left", "right", "opposite"]);
  return Object.entries(tags ?? {}).some(([key, value]) => {
    if (key === "oneway") return false; // Its normalized orientation is checked separately.
    if (
      key === "incline" ||
      key.startsWith("oneway:") ||
      key.split(":").some((part) => relative.has(part) || part === "direction")
    )
      return true;
    if (DESCRIPTIVE_KEYS.has(key) || DESCRIPTIVE_PREFIXES.some((prefix) => key.startsWith(prefix)))
      return false;
    return String(value)
      .toLowerCase()
      .split(/[^a-z]+/)
      .some((part) => relative.has(part));
  });
}

function distance(left: OsmNode | undefined, right: OsmNode | undefined) {
  if (!left || !right || ![left.lon, left.lat, right.lon, right.lat].every(Number.isFinite))
    return Number.POSITIVE_INFINITY;
  return haversineDistance([left.lon, left.lat], [right.lon, right.lat]);
}

function incidentWays(ways: Iterable<OsmWay>) {
  const result = new Map<number, Set<number>>();
  for (const way of ways)
    for (const ref of new Set(way.refs)) {
      const ids = result.get(ref) ?? new Set<number>();
      ids.add(way.id);
      result.set(ref, ids);
    }
  return result;
}

/** Produces detached plans without changing the trusted discovery or either input. */
export function assessWayRemovals(
  base: Osm,
  patch: Osm,
  discovery: OsmConflationDiscovery,
  decisions: ReadonlyMap<string, OsmConflationDecision>,
  resolve: (
    candidate: OsmConflationCandidate,
    decision?: OsmConflationDecision,
  ) => OsmConflationResolvedActions,
  current?: Osm,
) {
  const results = new Map<string, OsmConflationWayRemovalAssessment>();
  if (
    !discovery.options.allowWayRemoval ||
    !discovery.candidates.some((candidate) => candidate.entityType === "way")
  )
    return results;
  // Read only the points used by reviewed ways; copying every base node on each
  // checkbox edit would make small reviews expensive on large city extracts.
  const nodeCache = new Map<number, OsmNode | undefined>();
  const nodeAt = (id: number) => {
    if (!nodeCache.has(id))
      nodeCache.set(
        id,
        (current
          ? current.nodes.getById(id)
          : (patch.nodes.getById(id) ?? base.nodes.getById(id))) ?? undefined,
      );
    return nodeCache.get(id);
  };
  const originalWays = new Map<number, OsmWay>();
  for (const dataset of [base, patch])
    for (const way of dataset.ways) originalWays.set(way.id, way);
  const ways = new Map(originalWays);
  const attachments = new Map<number, { target: number; wayIds: Set<number> }>();
  const nodeCandidates = new Map<string, OsmConflationCandidate>();
  for (const candidate of discovery.candidates) {
    if (candidate.entityType !== "node" || candidate.targetId == null) continue;
    nodeCandidates.set(`${candidate.sourceId}:${candidate.targetId}`, candidate);
    if (resolve(candidate, decisions.get(candidate.id)).attachNetwork) {
      attachments.set(candidate.sourceId, {
        target: candidate.targetId,
        wayIds: new Set(candidate.evidence.patchWayIds ?? []),
      });
    }
  }
  if (current) {
    ways.clear();
    for (const way of current.ways) ways.set(way.id, way);
  } else {
    for (const [id, way] of ways) {
      if (base.ways.ids.has(id)) continue;
      ways.set(id, {
        ...way,
        refs: way.refs.map((ref) => {
          const attachment = attachments.get(ref);
          return attachment?.wayIds.has(id) ? attachment.target : ref;
        }),
      });
    }
  }
  const originalIncidence = incidentWays(originalWays.values());
  const currentIncidence = incidentWays(ways.values());
  // Keep membership evidence from every input version. An ordinary same-ID update
  // must not turn an original restriction blocker into permission to remove geometry.
  const relationsByMember = new Map<string, Set<number>>();
  for (const dataset of [base, patch, ...(current ? [current] : [])]) {
    for (const relation of dataset.relations)
      for (const member of relation.members) {
        const key = `${member.type}:${member.ref}`;
        const ids = relationsByMember.get(key) ?? new Set<number>();
        ids.add(relation.id);
        relationsByMember.set(key, ids);
      }
  }
  const selectedWays = new Set(
    discovery.candidates
      .filter(
        (candidate) =>
          candidate.entityType === "way" &&
          decisions.get(candidate.id)?.action === "accept" &&
          decisions.get(candidate.id)?.removeWay === true,
      )
      .map((candidate) => candidate.sourceId),
  );

  for (const candidate of discovery.candidates) {
    if (candidate.entityType !== "way") continue;
    if (candidate.targetId == null) {
      results.set(candidate.id, {
        status: "unmatched",
        reasons: ["way-removal-unsupported"],
        preview: null,
      });
      continue;
    }
    const source = patch.ways.getById(candidate.sourceId);
    const target = base.ways.getById(candidate.targetId);
    const currentSource = ways.get(candidate.sourceId);
    const currentTarget = ways.get(candidate.targetId);
    const reasons = new Set<OsmConflationReasonCode>(
      candidate.propertyTransfer.reasons.filter((reason) => MATCH_BLOCKERS.has(reason)),
    );
    const preview: OsmConflationWayRemovalPreview = {
      sourceWayId: candidate.sourceId,
      retainedWayId: candidate.targetId,
      orphanNodeIds: [],
      retainedTaggedNodeIds: [],
      connections: [],
      blockedNodeIds: [],
      blockingRelationIds: [],
      sourceTags: { ...source?.tags },
    };
    if (!source || !target || !currentSource || !currentTarget || base.ways.ids.has(source.id)) {
      reasons.add("way-removal-topology-conflict");
      results.set(candidate.id, { status: "blocked", reasons: [...reasons].toSorted(), preview });
      continue;
    }
    const unsupported = [source, target].some(
      (way) =>
        way.refs.length < 2 ||
        new Set(way.refs).size !== way.refs.length ||
        way.tags?.["area"] === "yes" ||
        way.tags?.["highway"] == null,
    );
    if (unsupported || source.refs.length !== target.refs.length)
      reasons.add("way-removal-unsupported");
    const first = source.refs[0];
    const last = source.refs.at(-1);
    const targetFirst = target.refs[0];
    const targetLast = target.refs.at(-1);
    const node = (id: number | undefined) => (id === undefined ? undefined : nodeAt(id));
    const forward =
      distance(node(first), node(targetFirst)) + distance(node(last), node(targetLast));
    const backward =
      distance(node(first), node(targetLast)) + distance(node(last), node(targetFirst));
    const reversed = backward < forward;
    const targetRefs = reversed ? target.refs.toReversed() : target.refs;
    const sourceDirection = normalizedWayDirection(source.tags);
    const targetDirection = normalizedWayDirection(target.tags);
    const expectedDirection = reversed
      ? targetDirection === "forward"
        ? "reverse"
        : targetDirection === "reverse"
          ? "forward"
          : targetDirection
      : targetDirection;
    const currentSourceDirection = normalizedWayDirection(currentSource.tags);
    const currentTargetDirection = normalizedWayDirection(currentTarget.tags);
    const currentExpectedDirection = reversed
      ? currentTargetDirection === "forward"
        ? "reverse"
        : currentTargetDirection === "reverse"
          ? "forward"
          : currentTargetDirection
      : currentTargetDirection;
    if (
      currentSourceDirection === "unsupported" ||
      currentSourceDirection !== currentExpectedDirection ||
      sourceDirection === "unsupported" ||
      sourceDirection !== expectedDirection ||
      !semanticTagsEqual(source.tags, target.tags, true) ||
      !semanticTagsEqual(currentSource.tags, currentTarget.tags, true)
    )
      reasons.add("way-removal-routing-conflict");
    if (
      reversed &&
      [source, target, currentSource, currentTarget].some((way) => hasRelativeDirection(way.tags))
    )
      reasons.add("way-removal-routing-conflict");
    if (
      currentTarget.refs.length !== target.refs.length ||
      currentTarget.refs.some((ref, index) => ref !== target.refs[index])
    )
      reasons.add("way-removal-topology-conflict");
    const expectedRefs = source.refs.map((ref) => {
      const attachment = attachments.get(ref);
      return attachment?.wayIds.has(source.id) ? attachment.target : ref;
    });
    if (
      currentSource.refs.length !== expectedRefs.length ||
      currentSource.refs.some((ref, index) => ref !== expectedRefs[index])
    )
      reasons.add("way-removal-topology-conflict");
    const involvedNodes = new Set([...source.refs, ...target.refs, ...currentSource.refs]);
    const relationIds = new Set([
      ...(relationsByMember.get(`way:${source.id}`) ?? []),
      ...(relationsByMember.get(`way:${target.id}`) ?? []),
    ]);
    for (const ref of involvedNodes)
      for (const id of relationsByMember.get(`node:${ref}`) ?? []) relationIds.add(id);
    preview.blockingRelationIds = [...relationIds];
    if (preview.blockingRelationIds.length) reasons.add("way-removal-relation-member");
    for (const [index, ref] of source.refs.entries()) {
      const paired = targetRefs[index];
      if (
        paired === undefined ||
        distance(node(ref), node(paired)) > discovery.options.maxDistanceMeters
      ) {
        reasons.add("way-removal-unsupported");
        preview.blockedNodeIds.push(ref);
      }
      if (
        !semanticTagsEqual(node(ref)?.tags, node(paired)?.tags, false) ||
        (reversed &&
          (hasRelativeDirection(node(ref)?.tags) || hasRelativeDirection(node(paired)?.tags)))
      ) {
        reasons.add("way-removal-routing-conflict");
        preview.blockedNodeIds.push(ref);
      }
      if (
        (base.nodes.ids.has(ref) && paired !== ref) ||
        (attachments.has(ref) && attachments.get(ref)?.target !== paired)
      ) {
        reasons.add("way-removal-topology-conflict");
        preview.blockedNodeIds.push(ref);
      }
      const branches = [
        ...new Set([...(originalIncidence.get(ref) ?? []), ...(currentIncidence.get(ref) ?? [])]),
      ]
        .filter((id) => id !== source.id)
        .toSorted((a, b) => a - b);
      if (!branches.length) continue;
      const attachment = paired === undefined ? undefined : nodeCandidates.get(`${ref}:${paired}`);
      const decision = attachment ? decisions.get(attachment.id) : undefined;
      const existing = ref === paired && base.nodes.ids.has(ref);
      const explicit =
        existing ||
        (decision?.action === "accept" &&
          decision.attachNetwork === true &&
          !!attachment &&
          resolve(attachment, decision).attachNetwork);
      const verified =
        paired !== undefined &&
        branches.every(
          (id) =>
            !selectedWays.has(id) &&
            ways.get(id)?.refs.includes(paired) &&
            (existing || !ways.get(id)?.refs.includes(ref)),
        );
      preview.connections.push({
        sourceNodeId: ref,
        targetNodeId: paired ?? null,
        retainedWayIds: branches,
        attachmentCandidateId: attachment?.id ?? null,
        explicitlyAccepted: explicit && verified,
      });
      if (!explicit || !verified) {
        reasons.add(
          branches.some((id) => selectedWays.has(id))
            ? "way-removal-topology-conflict"
            : "way-removal-connection-required",
        );
        preview.blockedNodeIds.push(ref);
      }
    }
    for (const ref of new Set([...source.refs, ...currentSource.refs])) {
      if (base.nodes.ids.has(ref) || !patch.nodes.ids.has(ref)) continue;
      if (Object.keys(nodeAt(ref)?.tags ?? {}).length) preview.retainedTaggedNodeIds.push(ref);
    }
    for (const ref of new Set(currentSource.refs)) {
      if (
        base.nodes.ids.has(ref) ||
        !patch.nodes.ids.has(ref) ||
        !nodeAt(ref) ||
        Object.keys(nodeAt(ref)?.tags ?? {}).length
      )
        continue;
      if ([...(currentIncidence.get(ref) ?? [])].some((id) => id !== source.id)) continue;
      if (relationsByMember.has(`node:${ref}`)) continue;
      preview.orphanNodeIds.push(ref);
    }
    preview.blockedNodeIds = [...new Set(preview.blockedNodeIds)].toSorted((a, b) => a - b);
    preview.blockingRelationIds.sort((a, b) => a - b);
    preview.orphanNodeIds.sort((a, b) => a - b);
    preview.retainedTaggedNodeIds.sort((a, b) => a - b);
    results.set(candidate.id, {
      status: reasons.size ? "blocked" : "review",
      reasons: [...reasons].toSorted(),
      preview,
    });
  }
  return results;
}
