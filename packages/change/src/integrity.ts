import type { Osm } from "@osmix/core";
import type { OsmRelation, OsmWay } from "@osmix/types";

import type { EarlierState, PlanOverlay } from "./plan/overlay.ts";
import { inputProvenance } from "./provenance.ts";
import { routingGradeSignature } from "./utils.ts";
import type { DatasetReader } from "./views.ts";

type IntegrityIssue = {
  key: string;
  description: string;
  /** The entities the issue is about, planned IDs, most specific first. */
  entities: PlanIntegrityEntity[];
};

/** An entity an integrity issue names. */
export interface PlanIntegrityEntity {
  type: "node" | "way" | "relation";
  id: number;
}

/** A new routing-integrity problem in a planned state, with the entities it is about. */
export interface PlanIntegrityIssue {
  description: string;
  entities: PlanIntegrityEntity[];
}

type IncidentHighway = {
  way: OsmWay;
  gradeSignature: string;
  interior: boolean;
  endpoint: boolean;
};

// Finalized Osm indexes are immutable. Keep their ordered analysis by object
// identity so adjacent merge stages do not rescan the same million-entity
// dataset. Never key this cache by the user-facing OSM ID: an ID may be reused
// for a newly merged dataset with different contents.
const routingIntegrityIssuesByOsm = new WeakMap<Osm, readonly IntegrityIssue[]>();

const SURFACE_GRADE_SIGNATURE = "layer=0|level=|bridge=no|tunnel=no|covered=no";

function sharesNode(a: OsmWay, b: OsmWay) {
  const aRefs = new Set(a.refs);
  return b.refs.some((ref) => aRefs.has(ref));
}

/**
 * A bridge or tunnel can legitimately terminate at a portal node on a surface network.
 * When an interior way also touches that portal (for example a crossing footway), the
 * same-grade endpoint continuation proves that the interior way is connected to the
 * surface side, not spliced into the grade-separated segment.
 */
function hasSameGradeEndpointContinuation(
  ways: readonly IncidentHighway[],
  left: IncidentHighway,
  right: IncidentHighway,
) {
  if (left.interior === right.interior) return false;

  const interiorWay = left.interior ? left : right;
  const interiorSignature = interiorWay.gradeSignature;
  // A continuation only proves a normal portal when the interior way is on the
  // default surface level. It must not legitimize a new surface endpoint spliced
  // into the middle of a tunnel or bridge.
  if (interiorSignature !== SURFACE_GRADE_SIGNATURE) return false;
  return ways.some(
    (candidate) =>
      candidate.way.id !== left.way.id &&
      candidate.way.id !== right.way.id &&
      candidate.endpoint &&
      candidate.gradeSignature === interiorSignature,
  );
}

function isAbsoluteIntegrityIssue(issue: IntegrityIssue) {
  return (
    /^way:[^:]+:missing-node:/.test(issue.key) ||
    /^way:[^:]+:degenerate-highway$/.test(issue.key) ||
    /^relation:[^:]+:missing-/.test(issue.key)
  );
}

/** @internal Validate a restriction against current or proposed way references. */
export function restrictionTopologyIssues(
  relation: OsmRelation,
  getWay: (id: number) => OsmWay | null | undefined,
): IntegrityIssue[] {
  if (relation.tags?.["type"] !== "restriction") return [];

  const issues: IntegrityIssue[] = [];
  const fromWays = relation.members
    .filter((member) => member.type === "way" && member.role === "from")
    .map((member) => getWay(member.ref))
    .filter((way): way is OsmWay => way != null);
  const toWays = relation.members
    .filter((member) => member.type === "way" && member.role === "to")
    .map((member) => getWay(member.ref))
    .filter((way): way is OsmWay => way != null);
  const viaNodes = relation.members.filter(
    (member) => member.type === "node" && member.role === "via",
  );
  const viaWays = relation.members
    .filter((member) => member.type === "way" && member.role === "via")
    .map((member) => getWay(member.ref))
    .filter((way): way is OsmWay => way != null);

  if (fromWays.length === 0) {
    issues.push({
      key: `restriction:${relation.id}:missing-from`,
      description: `restriction ${relation.id} has no existing from way`,
      entities: [{ type: "relation", id: relation.id }],
    });
  }
  if (toWays.length === 0) {
    issues.push({
      key: `restriction:${relation.id}:missing-to`,
      description: `restriction ${relation.id} has no existing to way`,
      entities: [{ type: "relation", id: relation.id }],
    });
  }
  if (viaNodes.length === 0 && viaWays.length === 0) {
    issues.push({
      key: `restriction:${relation.id}:missing-via`,
      description: `restriction ${relation.id} has no existing via member`,
      entities: [{ type: "relation", id: relation.id }],
    });
  }

  for (const viaNode of viaNodes) {
    const belongsToFrom = fromWays.some((way) => way.refs.includes(viaNode.ref));
    const belongsToTo = toWays.some((way) => way.refs.includes(viaNode.ref));
    if (!belongsToFrom || !belongsToTo) {
      const fromIds = fromWays.map((way) => way.id).join(", ");
      const toIds = toWays.map((way) => way.id).join(", ");
      issues.push({
        key: `restriction:${relation.id}:detached-via-node:${viaNode.ref}`,
        description: `restriction ${relation.id} via node ${viaNode.ref} is detached from its from/to ways (from: [${fromIds}]; to: [${toIds}]); keep the via node referenced by both sides`,
        entities: [
          { type: "node", id: viaNode.ref },
          ...[...fromWays, ...toWays].map((way) => ({ type: "way" as const, id: way.id })),
          { type: "relation", id: relation.id },
        ],
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
        entities: [
          ...viaWays.map((way) => ({ type: "way" as const, id: way.id })),
          ...[...fromWays, ...toWays].map((way) => ({ type: "way" as const, id: way.id })),
          { type: "relation", id: relation.id },
        ],
      });
    }
  }

  return issues;
}

function incompatibleGradePairs(ways: readonly IncidentHighway[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let leftIndex = 0; leftIndex < ways.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < ways.length; rightIndex++) {
      const left = ways[leftIndex]!;
      const right = ways[rightIndex]!;
      if (left.gradeSignature === right.gradeSignature) continue;
      if (!left.interior && !right.interior) continue;
      if (hasSameGradeEndpointContinuation(ways, left, right)) continue;
      pairs.push([Math.min(left.way.id, right.way.id), Math.max(left.way.id, right.way.id)]);
    }
  }
  return pairs;
}

/** @internal Check a proposed junction with the same portal rules as final validation. */
export function junctionHasIncompatibleGrades(nodeId: number, ways: readonly OsmWay[]) {
  const incident = ways
    .filter((way) => way.tags?.["highway"] != null && way.refs.includes(nodeId))
    .map((way) => ({
      way,
      gradeSignature: routingGradeSignature(way.tags),
      interior: way.refs.slice(1, -1).includes(nodeId),
      endpoint: way.refs[0] === nodeId || way.refs.at(-1) === nodeId,
    }));
  return incompatibleGradePairs(incident).length > 0;
}

/** Missing nodes and degenerate highways of one way. */
function wayIntegrityIssues(way: OsmWay, hasNode: (id: number) => boolean): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  for (const ref of way.refs) {
    if (hasNode(ref)) continue;
    issues.push({
      key: `way:${way.id}:missing-node:${ref}`,
      description: `way ${way.id} references missing node ${ref}`,
      entities: [{ type: "way", id: way.id }],
    });
  }
  if (way.tags?.["highway"] != null && new Set(way.refs).size < 2) {
    issues.push({
      key: `way:${way.id}:degenerate-highway`,
      description: `highway way ${way.id} has fewer than two distinct nodes`,
      entities: [{ type: "way", id: way.id }],
    });
  }
  return issues;
}

/** How a highway way meets `nodeId`, for the grade rule; null for other ways. */
function incidentHighway(way: OsmWay, nodeId: number): IncidentHighway | null {
  if (way.tags?.["highway"] == null || !way.refs.includes(nodeId)) return null;
  return {
    way,
    gradeSignature: routingGradeSignature(way.tags),
    interior: way.refs.slice(1, -1).includes(nodeId),
    endpoint: way.refs[0] === nodeId || way.refs.at(-1) === nodeId,
  };
}

/** Grade-separated highways joined at one node. */
function gradeIntegrityIssues(nodeId: number, ways: readonly IncidentHighway[]): IntegrityIssue[] {
  return incompatibleGradePairs(ways).map(([firstWayId, secondWayId]) => ({
    key: `node:${nodeId}:incompatible-grade:${firstWayId}:${secondWayId}`,
    description: `node ${nodeId} newly connects grade-separated highways ${firstWayId} and ${secondWayId}`,
    entities: [
      { type: "node", id: nodeId },
      { type: "way", id: firstWayId },
      { type: "way", id: secondWayId },
    ],
  }));
}

/** Missing members and restriction topology of one relation. */
function relationIntegrityIssues(
  relation: OsmRelation,
  exists: (type: "node" | "way" | "relation", id: number) => boolean,
  getWay: (id: number) => OsmWay | null | undefined,
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  for (const member of relation.members) {
    if (exists(member.type, member.ref)) continue;
    issues.push({
      key: `relation:${relation.id}:missing-${member.type}:${member.ref}`,
      description: `relation ${relation.id} references missing ${member.type} ${member.ref}`,
      entities: [{ type: "relation", id: relation.id }],
    });
  }
  issues.push(...restrictionTopologyIssues(relation, getWay));
  return issues;
}

function collectRoutingIntegrityIssues(osm: Osm | DatasetReader): readonly IntegrityIssue[] {
  const finalized = "isReady" in osm && osm.isReady() ? osm : undefined;
  const cachedIssues = finalized && routingIntegrityIssuesByOsm.get(finalized);
  if (cachedIssues) return cachedIssues;

  const issues: IntegrityIssue[] = [];
  const highwayWaysByNode = new Map<number, IncidentHighway[]>();
  const hasNode = (id: number) => osm.nodes.ids.has(id);

  for (const way of osm.ways) {
    issues.push(...wayIntegrityIssues(way, hasNode));
    if (way.tags?.["highway"] == null) continue;
    for (const ref of new Set(way.refs)) {
      const incident = highwayWaysByNode.get(ref) ?? [];
      incident.push(incidentHighway(way, ref)!);
      highwayWaysByNode.set(ref, incident);
    }
  }

  for (const [nodeId, ways] of highwayWaysByNode) {
    issues.push(...gradeIntegrityIssues(nodeId, ways));
  }

  const exists = (type: "node" | "way" | "relation", id: number) =>
    type === "node"
      ? osm.nodes.ids.has(id)
      : type === "way"
        ? osm.ways.ids.has(id)
        : osm.relations.ids.has(id);
  for (const relation of osm.relations) {
    issues.push(...relationIntegrityIssues(relation, exists, (id) => osm.ways.getById(id)));
  }

  if (finalized) routingIntegrityIssuesByOsm.set(finalized, issues);
  return issues;
}

/** Base relations by member, `type:id` → relation IDs; built once per base. */
const relationsByMemberByOsm = new WeakMap<Osm, Map<string, number[]>>();

function relationsByMember(base: Osm) {
  let index = relationsByMemberByOsm.get(base);
  if (index) return index;
  index = new Map();
  for (const relation of base.relations) {
    for (const { type, ref } of relation.members) {
      const key = `${type}:${ref}`;
      const ids = index.get(key);
      if (ids) {
        if (ids.at(-1) !== relation.id) ids.push(relation.id);
      } else index.set(key, [relation.id]);
    }
  }
  relationsByMemberByOsm.set(base, index);
  return index;
}

/** Whether a way meets `nodeId` the same way in both versions, for the grade rule. */
function sameIncidence(before: OsmWay | null, after: OsmWay | null, nodeId: number) {
  const a = before ? incidentHighway(before, nodeId) : null;
  const b = after ? incidentHighway(after, nodeId) : null;
  if (!a || !b) return a === b;
  return (
    a.interior === b.interior && a.endpoint === b.endpoint && a.gradeSignature === b.gradeSignature
  );
}

/**
 * Routing-integrity problems in an overlay that are not in `baselineKeys`, sorted by key. Only
 * what the overlay's records touch can differ from the base, whose issues the baseline holds:
 * - ways with a record, and ways at a base node with a record (a deleted node goes missing);
 * - for the grade rule, every node of a created way, and each node where a changed or deleted
 *   base way now meets it differently (position, presence or grade);
 * - relations with a record, or with a changed or deleted member.
 * The full scan in `assertValidResult` still checks the built result.
 */
export function newOverlayIntegrityIssues(
  baselineKeys: ReadonlySet<string>,
  overlay: PlanOverlay,
): PlanIntegrityIssue[] {
  const base = overlay.base;
  const issues: IntegrityIssue[] = [];
  const hasNode = (id: number) => overlay.getNode(id) != null;
  const changedWays = new Set<number>();
  const checkedWays = new Set<number>();
  const gradeNodes = new Set<number>();
  for (const key of Object.keys(overlay.wayChanges)) {
    const id = Number(key);
    if (!overlay.wayChanges[id]) continue;
    changedWays.add(id);
    const way = overlay.getWay(id);
    if (way) checkedWays.add(id);
    const before = base.ways.getById(id);
    if (!before) {
      for (const ref of way?.refs ?? []) gradeNodes.add(ref);
      continue;
    }
    for (const ref of new Set([...before.refs, ...(way?.refs ?? [])])) {
      if (!sameIncidence(before, way, ref)) gradeNodes.add(ref);
    }
  }
  const changedNodes: number[] = [];
  for (const key of Object.keys(overlay.nodeChanges)) {
    const id = Number(key);
    if (!overlay.nodeChanges[id]) continue;
    changedNodes.push(id);
    if (!base.nodes.ids.has(id)) continue;
    for (const way of overlay.waysAtNode(id)) checkedWays.add(way.id);
  }

  for (const id of checkedWays) {
    const way = overlay.getWay(id);
    if (way) issues.push(...wayIntegrityIssues(way, hasNode));
  }
  for (const nodeId of gradeNodes) {
    // A node only created ways use needs no spatial query, and fewer than two ways never
    // conflict; most imported vertices are both.
    if (!base.nodes.ids.has(nodeId) && overlay.pendingWayIdsAt(nodeId).size < 2) continue;
    const incident = overlay
      .waysAtNode(nodeId)
      .flatMap((way) => incidentHighway(way, nodeId) ?? []);
    if (incident.length < 2) continue;
    issues.push(...gradeIntegrityIssues(nodeId, incident));
  }

  const members = relationsByMember(base);
  const relations = new Set<number>();
  for (const key of Object.keys(overlay.relationChanges)) {
    const id = Number(key);
    if (overlay.relationChanges[id]) relations.add(id);
  }
  const addMembersOf = (type: string, id: number) => {
    for (const relationId of members.get(`${type}:${id}`) ?? []) relations.add(relationId);
  };
  for (const id of changedWays) addMembersOf("way", id);
  for (const id of changedNodes) addMembersOf("node", id);
  // Relations that contain a changed relation, and so on up: a Set visits what is added.
  for (const id of relations) addMembersOf("relation", id);
  const exists = (type: "node" | "way" | "relation", id: number) =>
    type === "node"
      ? overlay.getNode(id) != null
      : type === "way"
        ? overlay.getWay(id) != null
        : overlay.getRelation(id) != null;
  for (const id of relations) {
    const relation = overlay.getRelation(id);
    if (relation) {
      issues.push(...relationIntegrityIssues(relation, exists, (wayId) => overlay.getWay(wayId)));
    }
  }

  return issues
    .filter((issue) => !baselineKeys.has(issue.key))
    .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ description, entities }) => ({ description, entities }));
}

export function routingIntegrityIssueKeys(osm: Osm) {
  return new Set(collectRoutingIntegrityIssues(osm).map((issue) => issue.key));
}

/** Reuse analysis only when two finalized wrappers reference identical entity buffers. */
export function reuseRoutingIntegrityAnalysis(source: Osm, target: Osm) {
  const issues = collectRoutingIntegrityIssues(source);
  if (target.isReady()) routingIntegrityIssuesByOsm.set(target, issues);
}

/**
 * Combine inherited issues from both inputs while treating same-ID patch entities as
 * modifications that must remain valid when their base counterpart was valid.
 */
export function inheritedRoutingIntegrityIssueKeys(
  base: Osm,
  patch: Osm,
  baseKeys: ReadonlySet<string> = routingIntegrityIssueKeys(base),
) {
  const keys = new Set(baseKeys);
  const provenance = inputProvenance(base, patch);
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
      kind === "node" || kind === "way" || kind === "relation"
        ? provenance.isBase(kind, id)
        : false;
    if (!collidesWithBase) keys.add(issue.key);
  }
  return keys;
}

/** Routing-integrity problems in `merged` that are not in `baselineKeys`, described. */
export function newRoutingIntegrityIssues(
  baselineKeys: ReadonlySet<string>,
  merged: Osm | DatasetReader,
): string[] {
  return collectRoutingIntegrityIssues(merged)
    .filter((issue) => !baselineKeys.has(issue.key))
    .map((issue) => issue.description);
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

/** Base entities an included way replacement may delete or, for relations, re-member (MP-R2). */
export interface ReplacedBaseEntities {
  ways: ReadonlySet<number>;
  nodes: ReadonlySet<number>;
  relations: ReadonlySet<number>;
}

/**
 * Ensure fuzzy conflation did not rewrite geometry or relation topology that already existed in
 * the base. Same-ID patch updates are compared at the ordinary-merge baseline, not the raw base.
 * `replaced` names the only base entities an included way replacement may delete or re-member.
 *
 * Both states are overlays of the base, so only entities with a record in either can differ;
 * those are all that is checked.
 */
export function assertConflationPreservesBaseTopology(
  originalBase: Osm,
  ordinaryBaseline: EarlierState,
  conflated: PlanOverlay,
  replaced?: ReplacedBaseEntities,
) {
  const violations: string[] = [];
  const changed = (type: "node" | "way" | "relation") => ordinaryBaseline.changedIds(type);
  for (const id of changed("node")) {
    if (!originalBase.nodes.ids.has(id)) continue;
    const baseline = ordinaryBaseline.getNode(id);
    const result = conflated.getNode(id);
    if (baseline && !result && replaced?.nodes.has(id)) continue;
    if (!baseline || !result) {
      violations.push(`base node ${id} was removed`);
      continue;
    }
    if (baseline.lon !== result.lon || baseline.lat !== result.lat) {
      violations.push(`base node ${id} coordinates changed`);
    }
  }
  for (const id of changed("way")) {
    if (!originalBase.ways.ids.has(id)) continue;
    const baseline = ordinaryBaseline.getWay(id);
    const result = conflated.getWay(id);
    if (baseline && !result && replaced?.ways.has(id)) continue;
    if (!baseline || !result) {
      violations.push(`base way ${id} was removed`);
      continue;
    }
    if (
      baseline.refs.length !== result.refs.length ||
      baseline.refs.some((ref, index) => ref !== result.refs[index])
    ) {
      violations.push(`base way ${id} references changed`);
    }
  }
  for (const id of changed("relation")) {
    if (!originalBase.relations.ids.has(id)) continue;
    const baseline = ordinaryBaseline.getRelation(id);
    const result = conflated.getRelation(id);
    if (!baseline || !result) {
      violations.push(`base relation ${id} was removed`);
      continue;
    }
    if (replaced?.relations.has(id)) continue;
    if (
      baseline.members.length !== result.members.length ||
      baseline.members.some((member, index) => {
        const resultMember = result.members[index];
        return (
          !resultMember ||
          member.type !== resultMember.type ||
          member.ref !== resultMember.ref ||
          member.role !== resultMember.role
        );
      })
    ) {
      violations.push(`base relation ${id} members changed`);
    }
  }
  if (violations.length === 0) return;
  const descriptions = violations.slice(0, 10);
  const omitted = violations.length - descriptions.length;
  const suffix = omitted > 0 ? `; and ${omitted} more` : "";
  throw Error(`Conflation changed protected base topology: ${descriptions.join("; ")}${suffix}`);
}
