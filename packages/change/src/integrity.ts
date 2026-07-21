import type { Osm } from "@osmix/core";
import type { OsmRelation, OsmWay } from "@osmix/types";

import { routingGradeSignature } from "./utils.ts";

type IntegrityIssue = {
  key: string;
  description: string;
};

const SURFACE_GRADE_SIGNATURE = "layer=0|level=|bridge=no|tunnel=no|covered=no";

function sharesNode(a: OsmWay, b: OsmWay) {
  const aRefs = new Set(a.refs);
  return b.refs.some((ref) => aRefs.has(ref));
}

function isInteriorNode(way: OsmWay, nodeId: number) {
  return way.refs.some((ref, index) => ref === nodeId && index > 0 && index < way.refs.length - 1);
}

function isEndpointNode(way: OsmWay, nodeId: number) {
  return way.refs[0] === nodeId || way.refs.at(-1) === nodeId;
}

/**
 * A bridge or tunnel can legitimately terminate at a portal node on a surface network.
 * When an interior way also touches that portal (for example a crossing footway), the
 * same-grade endpoint continuation proves that the interior way is connected to the
 * surface side, not spliced into the grade-separated segment.
 */
function hasSameGradeEndpointContinuation(
  ways: readonly OsmWay[],
  left: OsmWay,
  right: OsmWay,
  nodeId: number,
) {
  const leftInterior = isInteriorNode(left, nodeId);
  const rightInterior = isInteriorNode(right, nodeId);
  if (leftInterior === rightInterior) return false;

  const interiorWay = leftInterior ? left : right;
  const interiorSignature = routingGradeSignature(interiorWay.tags);
  // A continuation only proves a normal portal when the interior way is on the
  // default surface level. It must not legitimize a new surface endpoint spliced
  // into the middle of a tunnel or bridge.
  if (interiorSignature !== SURFACE_GRADE_SIGNATURE) return false;
  return ways.some(
    (candidate) =>
      candidate.id !== left.id &&
      candidate.id !== right.id &&
      isEndpointNode(candidate, nodeId) &&
      routingGradeSignature(candidate.tags) === interiorSignature,
  );
}

function isAbsoluteIntegrityIssue(issue: IntegrityIssue) {
  return (
    /^way:[^:]+:missing-node:/.test(issue.key) ||
    /^way:[^:]+:degenerate-highway$/.test(issue.key) ||
    /^relation:[^:]+:missing-/.test(issue.key)
  );
}

function restrictionIssues(osm: Osm, relation: OsmRelation): IntegrityIssue[] {
  if (relation.tags?.["type"] !== "restriction") return [];

  const issues: IntegrityIssue[] = [];
  const fromWays = relation.members
    .filter((member) => member.type === "way" && member.role === "from")
    .map((member) => osm.ways.getById(member.ref))
    .filter((way): way is OsmWay => way != null);
  const toWays = relation.members
    .filter((member) => member.type === "way" && member.role === "to")
    .map((member) => osm.ways.getById(member.ref))
    .filter((way): way is OsmWay => way != null);
  const viaNodes = relation.members.filter(
    (member) => member.type === "node" && member.role === "via",
  );
  const viaWays = relation.members
    .filter((member) => member.type === "way" && member.role === "via")
    .map((member) => osm.ways.getById(member.ref))
    .filter((way): way is OsmWay => way != null);

  if (fromWays.length === 0) {
    issues.push({
      key: `restriction:${relation.id}:missing-from`,
      description: `restriction ${relation.id} has no existing from way`,
    });
  }
  if (toWays.length === 0) {
    issues.push({
      key: `restriction:${relation.id}:missing-to`,
      description: `restriction ${relation.id} has no existing to way`,
    });
  }
  if (viaNodes.length === 0 && viaWays.length === 0) {
    issues.push({
      key: `restriction:${relation.id}:missing-via`,
      description: `restriction ${relation.id} has no existing via member`,
    });
  }

  for (const viaNode of viaNodes) {
    const belongsToFrom = fromWays.some((way) => way.refs.includes(viaNode.ref));
    const belongsToTo = toWays.some((way) => way.refs.includes(viaNode.ref));
    if (!belongsToFrom || !belongsToTo) {
      issues.push({
        key: `restriction:${relation.id}:detached-via-node:${viaNode.ref}`,
        description: `restriction ${relation.id} via node ${viaNode.ref} is detached from its from/to ways`,
      });
    }
  }

  if (viaWays.length > 0 && fromWays.length > 0 && toWays.length > 0) {
    const connectedFrom = fromWays.some((way) => sharesNode(way, viaWays[0]!));
    const connectedTo = toWays.some((way) => sharesNode(viaWays.at(-1)!, way));
    const connectedChain = viaWays.every(
      (way, index) => index === 0 || sharesNode(viaWays[index - 1]!, way),
    );
    if (!connectedFrom || !connectedChain || !connectedTo) {
      issues.push({
        key: `restriction:${relation.id}:detached-via-way-chain`,
        description: `restriction ${relation.id} has a disconnected via-way chain`,
      });
    }
  }

  return issues;
}

function collectRoutingIntegrityIssues(osm: Osm): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const highwayWaysByNode = new Map<number, OsmWay[]>();

  for (const way of osm.ways) {
    for (const ref of way.refs) {
      if (osm.nodes.ids.has(ref)) continue;
      issues.push({
        key: `way:${way.id}:missing-node:${ref}`,
        description: `way ${way.id} references missing node ${ref}`,
      });
    }
    if (way.tags?.["highway"] != null && new Set(way.refs).size < 2) {
      issues.push({
        key: `way:${way.id}:degenerate-highway`,
        description: `highway way ${way.id} has fewer than two distinct nodes`,
      });
    }
    if (way.tags?.["highway"] != null) {
      for (const ref of new Set(way.refs)) {
        const incidentWays = highwayWaysByNode.get(ref) ?? [];
        incidentWays.push(way);
        highwayWaysByNode.set(ref, incidentWays);
      }
    }
  }

  for (const [nodeId, ways] of highwayWaysByNode) {
    for (let leftIndex = 0; leftIndex < ways.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < ways.length; rightIndex++) {
        const left = ways[leftIndex]!;
        const right = ways[rightIndex]!;
        if (routingGradeSignature(left.tags) === routingGradeSignature(right.tags)) continue;
        if (!isInteriorNode(left, nodeId) && !isInteriorNode(right, nodeId)) continue;
        if (hasSameGradeEndpointContinuation(ways, left, right, nodeId)) continue;
        const [firstWayId, secondWayId] = [left.id, right.id].toSorted((a, b) => a - b);
        issues.push({
          key: `node:${nodeId}:incompatible-grade:${firstWayId}:${secondWayId}`,
          description: `node ${nodeId} newly connects grade-separated highways ${firstWayId} and ${secondWayId}`,
        });
      }
    }
  }

  for (const relation of osm.relations) {
    for (const member of relation.members) {
      const exists =
        member.type === "node"
          ? osm.nodes.ids.has(member.ref)
          : member.type === "way"
            ? osm.ways.ids.has(member.ref)
            : osm.relations.ids.has(member.ref);
      if (exists) continue;
      issues.push({
        key: `relation:${relation.id}:missing-${member.type}:${member.ref}`,
        description: `relation ${relation.id} references missing ${member.type} ${member.ref}`,
      });
    }
    issues.push(...restrictionIssues(osm, relation));
  }

  return issues;
}

export function routingIntegrityIssueKeys(osm: Osm) {
  return new Set(collectRoutingIntegrityIssues(osm).map((issue) => issue.key));
}

/**
 * Combine inherited issues from both inputs while treating same-ID patch entities as
 * modifications that must remain valid when their base counterpart was valid.
 */
export function inheritedRoutingIntegrityIssueKeys(base: Osm, patch: Osm) {
  const keys = routingIntegrityIssueKeys(base);
  for (const issue of collectRoutingIntegrityIssues(patch)) {
    // Missing references and degenerate highways in a patch are never inherited:
    // accepting them would allow malformed input to pass through unchanged.
    if (isAbsoluteIntegrityIssue(issue)) continue;
    const [kind, idText] = issue.key.split(":");
    // Restriction topology must be evaluated in the merged entity context. A patch
    // relation may legitimately reference base ways, so its patch-only issue is not
    // evidence of a pre-existing defect and must never suppress merged validation.
    if (kind === "restriction") continue;
    const id = Number(idText);
    const collidesWithBase =
      kind === "node"
        ? base.nodes.ids.has(id)
        : kind === "way"
          ? base.ways.ids.has(id)
          : kind === "relation" || kind === "restriction"
            ? base.relations.ids.has(id)
            : false;
    if (!collidesWithBase) keys.add(issue.key);
  }
  return keys;
}

/** Throw when a merge introduces routing-integrity issues not present in the base dataset. */
export function assertNoNewRoutingIntegrityIssues(baselineKeys: ReadonlySet<string>, merged: Osm) {
  const newIssues = collectRoutingIntegrityIssues(merged).filter(
    (issue) => !baselineKeys.has(issue.key),
  );
  if (newIssues.length === 0) return;

  const descriptions = newIssues.slice(0, 10).map((issue) => issue.description);
  const omitted = newIssues.length - descriptions.length;
  const suffix = omitted > 0 ? `; and ${omitted} more` : "";
  throw Error(`Merge introduced routing-integrity problems: ${descriptions.join("; ")}${suffix}`);
}
