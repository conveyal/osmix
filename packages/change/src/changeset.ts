/**
 * OSM changeset tracking and manipulation.
 *
 * The OsmChangeset class tracks creates, modifies, and deletes for nodes, ways,
 * and relations. It provides methods for deduplication, intersection creation,
 * and direct merging of OSM datasets.
 *
 * @module
 */

import type { Nodes, Osm, Ways } from "@osmix/core";
import { toMicroDegrees } from "@osmix/geo/coordinates";
import type {
  GeoBbox2D,
  OsmEntity,
  OsmEntityType,
  OsmEntityTypeMap,
  OsmNode,
  OsmRelation,
  OsmWay,
} from "@osmix/types";
import { entityPropertiesEqual } from "@osmix/types/utils";
import { normalizedWayDirection } from "@osmix/types/way-direction";
import { dequal } from "dequal"; // dequal/lite does not work with `TypedArray`s

import {
  assertNoNewRoutingIntegrityIssues,
  inheritedRoutingIntegrityIssueKeys,
  junctionHasIncompatibleGrades,
  newOverlayIntegrityIssues,
  restrictionTopologyIssues,
  routingIntegrityIssueKeys,
} from "./integrity.ts";
import { CrossingCache } from "./plan/crossing-cache.ts";
import { PlanOverlay } from "./plan/overlay.ts";
import { accessSignature, barrierSignature, NODE_ROUTING_CRITICAL_TAGS } from "./rules/access.ts";
import { refsWouldCollapse } from "./rules/collapse.ts";
import {
  assessNodeIdentity,
  assessNodeTags,
  mergeImportedTags,
  canDropReplacedNode,
  mergesTags,
  wayPairJoinable,
} from "./rules/node-identity.ts";
import {
  isDescriptiveWayTag,
  routingSemanticTagsEqual,
  withNonConflictingDescriptiveTags,
  withNonConflictingTags,
} from "./rules/tags.ts";
import type { OsmChange, OsmChangesetStats, OsmEntityRef } from "./types.ts";
import {
  areWayTagsIntersectionCandidate,
  nearestNodeOnWay,
  removeDuplicateAdjacentRelationMembers,
  removeDuplicateAdjacentWayRefs,
  routingGradeSignature,
  waysIntersect,
  waysShouldConnect,
} from "./utils.ts";

type ReplacementMap = Map<number, number>;
type IdIndex = Nodes["ids"];
type ExactWayIndex = Map<number, number | number[]>;
type WaysByNode = ReadonlyMap<number, readonly OsmWay[]>;

interface NodeCandidate {
  baseNodes: OsmNode[];
  patchNode: OsmNode;
}

/** How crossing insertion finds candidate ways: in the state crossings started from. */
interface CrossingSearch {
  /** A way's bounding box in the starting state, or null when it is absent there. */
  startBbox(wayId: number): GeoBbox2D | null;
  /** Ways whose starting bounding box intersects `wayId`'s box `bbox`, in ascending ID order. */
  near(bbox: GeoBbox2D, wayId: number): number[];
  /** Where two ways' lines cross; `waysIntersect` unless the search can reuse a result. */
  intersect?(wayId: number, line: Line, otherId: number, other: Line): [number, number][];
}

type Line = [number, number][];

/** One crossing about to be inserted, offered to an `accept` callback. */
export interface CrossingInsertion {
  /** `snap` reuses an existing vertex; `node` creates a new crossing node. */
  kind: "snap" | "node";
  wayId: number;
  otherWayId: number;
  point: [number, number];
  /** Two existing vertices that become one: `replaced` is rewritten to `survivor`. */
  merges?: { replaced: number; survivor: number };
  /** Why the snap needs a person before it applies, such as `grade-change` (MP-X1). */
  reviewReasons?: string[];
}

interface IntersectionJunctionReplacement {
  ways: OsmWay[];
  restrictions: OsmRelation[];
}

/** Two close vertices at a crossing that become one: `replaced` is rewritten to `survivor`. */
interface IntersectionNodeResolution {
  keepWayNode: boolean;
  replaced: OsmNode;
  survivor: OsmNode;
  reviewReasons?: string[];
}

const EMPTY_ID = -1;

/** Whether `nodeId` is the first or last node of an open way. */
function wayEndsAt(way: OsmWay, nodeId: number) {
  const first = way.refs[0];
  const last = way.refs.at(-1);
  if (first === last) return false;
  return first === nodeId || last === nodeId;
}

/** Whether two nodes differ in vertical context, access or barriers (group consistency). */
function nodeSignaturesDiffer(a: OsmNode["tags"], b: OsmNode["tags"]) {
  return (
    routingGradeSignature(a) !== routingGradeSignature(b) ||
    accessSignature(a) !== accessSignature(b) ||
    barrierSignature(a) !== barrierSignature(b)
  );
}

function sameOsmCoordinate(a: OsmNode, b: OsmNode) {
  return (
    toMicroDegrees(a.lon) === toMicroDegrees(b.lon) &&
    toMicroDegrees(a.lat) === toMicroDegrees(b.lat)
  );
}

function hashText(hash: number, value: string) {
  let nextHash = hash;
  for (let index = 0; index < value.length; index++) {
    nextHash ^= value.charCodeAt(index);
    nextHash = Math.imul(nextHash, 16_777_619);
  }
  return nextHash >>> 0;
}

/**
 * Produce a compact lookup key for exact way reconciliation. Hash collisions are
 * expected and harmless because candidates still pass the complete refs and tag
 * predicates before they can be accepted.
 */
function exactWayHash(way: OsmWay) {
  let hash = 2_166_136_261;
  hash = hashText(hash, `${way.refs.length}:`);
  for (const ref of way.refs) hash = hashText(hash, `${ref},`);
  hash = hashText(hash, `direction:${normalizedWayDirection(way.tags)};`);
  for (const [key, value] of Object.entries(way.tags ?? {}).toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (key === "oneway" || isDescriptiveWayTag(key)) continue;
    hash = hashText(hash, `${key.length}:${key}${String(value).length}:${String(value)}`);
  }
  return hash;
}

function nodeRoutingTagCount(node: OsmNode) {
  return NODE_ROUTING_CRITICAL_TAGS.reduce(
    (count, key) => count + (node.tags?.[key] == null ? 0 : 1),
    0,
  );
}

function wayBbox(coordinates: [number, number][]): [number, number, number, number] {
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
  return [minLon, minLat, maxLon, maxLat];
}

function bboxesIntersect(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
) {
  if (a[0] > a[2] || a[1] > a[3] || b[0] > b[2] || b[1] > b[3]) return false;
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Return the true maximum ID regardless of insertion order. */
function maximumId(ids: IdIndex): number | null {
  if (ids.size === 0) return null;

  if (ids.isReady()) {
    return ids.sorted[ids.sorted.length - 1] ?? null;
  }

  let maximum = ids.at(0);
  for (let index = 1; index < ids.size; index++) {
    maximum = Math.max(maximum, ids.at(index));
  }
  return maximum;
}

function containsId(ids: IdIndex, id: number) {
  if (ids.isReady()) return ids.has(id);
  for (let index = 0; index < ids.size; index++) {
    if (ids.at(index) === id) return true;
  }
  return false;
}

function resolveReplacement(id: number, replacementMap: ReplacementMap) {
  let resolvedId = id;
  const visited = new Set<number>();
  while (replacementMap.has(resolvedId)) {
    if (visited.has(resolvedId)) {
      throw Error(`Replacement cycle detected at entity ${resolvedId}`);
    }
    visited.add(resolvedId);
    resolvedId = replacementMap.get(resolvedId)!;
  }
  return resolvedId;
}

function flattenReplacementMap(replacementMap: ReplacementMap) {
  const flattenedMap: ReplacementMap = new Map();
  for (const fromId of replacementMap.keys()) {
    const finalId = resolveReplacement(fromId, replacementMap);
    if (fromId !== finalId) flattenedMap.set(fromId, finalId);
  }
  return flattenedMap;
}

/** @internal A copy of a changeset's records and counters. */
export interface OsmChangesetCheckpoint {
  nodes: Record<number, OsmChange<OsmEntityTypeMap["node"]>>;
  ways: Record<number, OsmChange<OsmEntityTypeMap["way"]>>;
  relations: Record<number, OsmChange<OsmEntityTypeMap["relation"]>>;
  counters: Pick<
    OsmChangeset,
    | "currentNodeId"
    | "deduplicatedNodes"
    | "deduplicatedNodesReplaced"
    | "deduplicatedWays"
    | "intersectionPointsFound"
    | "intersectionNodesCreated"
    | "intersectionNodesRemoved"
  >;
}

/**
 * Tracks changes to an OSM dataset and provides utilities for deduplication and merging.
 *
 * The changeset maintains a record of creates, modifies, and deletes for nodes, ways,
 * and relations. It is optimized to minimize full entity retrieval until necessary.
 */
export class OsmChangeset {
  osm: Osm;
  /** The planned state: base plus these changes, read without building it. */
  readonly overlay: PlanOverlay;
  private readonly routingIntegrityBaselineKeys: Set<string>;

  // Next node ID tracker for generating new IDs during intersection creation
  currentNodeId: number;
  /** Crossing work a replan can reuse; it holds no records, so restoring never touches it. */
  private readonly crossingCache = new CrossingCache();

  deduplicatedNodes = 0;
  deduplicatedNodesReplaced = 0;
  deduplicatedWays = 0;
  intersectionPointsFound = 0;
  intersectionNodesCreated = 0;
  /** Imported points an intersection replaced and left unused, so they were dropped. */
  intersectionNodesRemoved = 0;

  constructor(base: Osm) {
    this.osm = base;
    this.overlay = new PlanOverlay(base);
    this.currentNodeId = maximumId(base.nodes.ids) ?? EMPTY_ID;
    this.routingIntegrityBaselineKeys = routingIntegrityIssueKeys(base);
  }

  get nodeChanges() {
    return this.overlay.nodeChanges;
  }

  set nodeChanges(records: Record<number, OsmChange<OsmEntityTypeMap["node"]>>) {
    this.overlay.setRecords("node", records);
  }

  get wayChanges() {
    return this.overlay.wayChanges;
  }

  set wayChanges(records: Record<number, OsmChange<OsmEntityTypeMap["way"]>>) {
    this.overlay.setRecords("way", records);
  }

  get relationChanges() {
    return this.overlay.relationChanges;
  }

  set relationChanges(records: Record<number, OsmChange<OsmEntityTypeMap["relation"]>>) {
    this.overlay.setRecords("relation", records);
  }

  /** @internal Throw when `result` has routing-integrity problems the inputs did not. */
  assertValidResult(result: Osm): void {
    assertNoNewRoutingIntegrityIssues(this.routingIntegrityBaselineKeys, result);
  }

  /** @internal Everything a plan phase can change, to return to before rerunning it. */
  checkpoint(): OsmChangesetCheckpoint {
    return {
      nodes: { ...this.nodeChanges },
      ways: { ...this.wayChanges },
      relations: { ...this.relationChanges },
      counters: {
        currentNodeId: this.currentNodeId,
        deduplicatedNodes: this.deduplicatedNodes,
        deduplicatedNodesReplaced: this.deduplicatedNodesReplaced,
        deduplicatedWays: this.deduplicatedWays,
        intersectionPointsFound: this.intersectionPointsFound,
        intersectionNodesCreated: this.intersectionNodesCreated,
        intersectionNodesRemoved: this.intersectionNodesRemoved,
      },
    };
  }

  /** @internal The planned state at a checkpoint, read-only, sharing its records. */
  checkpointState(checkpoint: OsmChangesetCheckpoint): PlanOverlay {
    return PlanOverlay.frozen(this.osm, checkpoint);
  }

  /** @internal Return to a checkpoint. The checkpoint stays valid for another restore. */
  restore(checkpoint: OsmChangesetCheckpoint) {
    this.nodeChanges = { ...checkpoint.nodes };
    this.wayChanges = { ...checkpoint.ways };
    this.relationChanges = { ...checkpoint.relations };
    Object.assign(this, checkpoint.counters);
  }

  /** @internal New routing-integrity problems in the planned state, before any build. */
  pendingIntegrityIssues(): string[] {
    return newOverlayIntegrityIssues(this.routingIntegrityBaselineKeys, this.overlay);
  }

  private inheritPatchIntegrity(patch: Osm) {
    for (const key of inheritedRoutingIntegrityIssueKeys(
      this.osm,
      patch,
      this.routingIntegrityBaselineKeys,
    )) {
      this.routingIntegrityBaselineKeys.add(key);
    }
  }

  get stats(): OsmChangesetStats {
    const byType = { create: 0, modify: 0, delete: 0 };
    const count = (changes: Record<number, OsmChange>) => {
      const values = Object.values(changes);
      for (const change of values) byType[change.changeType]++;
      return values.length;
    };
    const nodeChanges = count(this.nodeChanges);
    const wayChanges = count(this.wayChanges);
    const relationChanges = count(this.relationChanges);
    return {
      osmId: this.osm.id,
      totalChanges: nodeChanges + wayChanges + relationChanges,
      nodeChanges,
      wayChanges,
      relationChanges,
      createChanges: byType.create,
      modifyChanges: byType.modify,
      deleteChanges: byType.delete,
      deduplicatedNodes: this.deduplicatedNodes,
      deduplicatedNodesReplaced: this.deduplicatedNodesReplaced,
      deduplicatedWays: this.deduplicatedWays,
      intersectionPointsFound: this.intersectionPointsFound,
      intersectionNodesCreated: this.intersectionNodesCreated,
      intersectionNodesRemoved: this.intersectionNodesRemoved,
    };
  }

  changes<T extends OsmEntityType>(type: T): Record<number, OsmChange<OsmEntityTypeMap[T]>> {
    return this.overlay.changes(type);
  }

  /** 1 allocates above every node (staged changesets); -1 allocates below (plans). */
  private nodeIdStep: 1 | -1 = 1;

  nextNodeId() {
    if (!Number.isSafeInteger(this.currentNodeId)) {
      throw Error("Cannot allocate node ID outside the safe integer range");
    }
    const nextId = this.currentNodeId + this.nodeIdStep;
    if (!Number.isSafeInteger(nextId)) {
      throw Error("Cannot allocate node ID outside the safe integer range");
    }
    if (containsId(this.osm.nodes.ids, nextId) || this.nodeChanges[nextId]) {
      throw Error(`Cannot allocate node ID ${nextId}: ID already exists`);
    }
    this.currentNodeId = nextId;
    return nextId;
  }

  create(entity: OsmEntity, osmId: string, refs?: OsmEntityRef[]) {
    this.overlay.create(entity, osmId, refs);
  }

  /**
   * Add or update an `OsmChange` for a given entity.
   * Requires the entity to exist in the base OSM dataset (or have a previous 'create' change).
   *
   * For augmented diffs, the `oldEntity` field captures the state of the entity before
   * modification (the original entity from the base dataset).
   */
  modify<T extends OsmEntityType>(
    type: T,
    id: number,
    modify: (entity: OsmEntityTypeMap[T]) => OsmEntityTypeMap[T],
  ): void {
    this.overlay.modify(type, id, modify);
  }

  getEntity<T extends OsmEntityType>(type: T, id: number): OsmEntityTypeMap[T] | undefined {
    return this.overlay.baseEntity(type, id);
  }

  /**
   * Schedule an entity for deletion.
   *
   * For augmented diffs, the `oldEntity` field is set to the entity being deleted,
   * capturing its state before removal.
   */
  delete(entity: OsmEntity, refs?: OsmEntityRef[]) {
    this.overlay.delete(entity, refs);
  }

  private currentWays() {
    return this.overlay.ways();
  }

  private currentRelations() {
    return this.overlay.relations();
  }

  private nodeContextsCompatible(
    patchNode: OsmNode,
    baseNode: OsmNode,
    waysByNode: WaysByNode,
    sameDataset: boolean,
  ) {
    const assessment = assessNodeIdentity(
      "exact",
      patchNode,
      baseNode,
      waysByNode.get(patchNode.id) ?? [],
      waysByNode.get(baseNode.id) ?? [],
      { sourceIsImported: !sameDataset },
    );
    return assessment.hardReasons.length === 0;
  }

  /**
   * Build incident-way context in one pass, but only for nodes that already have
   * an exact-coordinate candidate. This replaces a full way scan per candidate.
   */
  private currentWaysByNode(nodeIds: ReadonlySet<number>): WaysByNode {
    const waysByNode = new Map<number, OsmWay[]>();
    for (const nodeId of nodeIds) waysByNode.set(nodeId, []);
    if (waysByNode.size === 0) return waysByNode;

    for (const way of this.currentWays()) {
      let matchedRefs: Set<number> | undefined;
      for (const ref of way.refs) {
        const incidentWays = waysByNode.get(ref);
        if (!incidentWays || matchedRefs?.has(ref)) continue;
        incidentWays.push(way);
        (matchedRefs ??= new Set()).add(ref);
      }
    }
    return waysByNode;
  }

  private removeUnsafeNodeReplacements(replacementMap: ReplacementMap) {
    if (replacementMap.size === 0) return;
    let changed = true;
    while (changed) {
      changed = false;
      for (const way of this.currentWays()) {
        if (way.tags?.["highway"] == null || new Set(way.refs).size < 2) continue;
        const replacedRefs = way.refs.map((ref) => replacementMap.get(ref) ?? ref);
        if (new Set(replacedRefs).size >= 2) continue;
        for (const ref of way.refs) {
          if (!replacementMap.delete(ref)) continue;
          changed = true;
        }
      }
    }
  }

  /**
   * A blank target can accept incompatible sources independently. Validate the
   * complete group against itself before copying tags or rewriting references;
   * retaining every source in a conflicting group avoids choosing by input order.
   * The supplied map must point directly to final survivors, including
   * same-dataset replacement chains.
   */
  private removeConflictingNodeReplacements(
    replacementMap: ReplacementMap,
    waysByNode: WaysByNode,
  ) {
    const groups = new Map<number, number[]>();
    for (const [sourceId, targetId] of replacementMap) {
      const group = groups.get(targetId) ?? [targetId];
      group.push(sourceId);
      groups.set(targetId, group);
    }
    for (const group of groups.values()) {
      if (this.nodeReplacementGroupCompatible(group, waysByNode)) continue;
      for (const id of group) replacementMap.delete(id);
    }
  }

  private nodeReplacementGroupCompatible(group: readonly number[], waysByNode: WaysByNode) {
    const survivorId = group[0]!;
    if (!this.getCurrentNode(survivorId)) return false;
    // Imported values replace the survivor's (MP-X1), so imported sources only need to agree
    // with each other; within one dataset the survivor's own values must agree too.
    const imported = group.slice(1).every((id) => this.nodeChanges[id]?.changeType === "create");
    const agreeing = imported ? group.slice(1) : group;
    const firstNode = this.getCurrentNode(agreeing[0]!);
    if (!firstNode) return false;
    const tagValues = new Map<string, string | number>();
    for (const id of agreeing) {
      const node = this.getCurrentNode(id);
      if (!node || nodeSignaturesDiffer(firstNode.tags, node.tags)) return false;
      for (const [key, value] of Object.entries(node.tags ?? {})) {
        const previous = tagValues.get(key);
        if (previous !== undefined && previous !== value) return false;
        tagValues.set(key, value);
      }
    }

    // The survivor's own junction may already mix contexts (a footway and a private road);
    // each source's ways only need one way there they can join. A blank survivor has no ways,
    // so the sources' ways must agree with each other instead.
    const survivorWays = waysByNode.get(survivorId) ?? [];
    const sourceWays = group.slice(1).flatMap((id) => waysByNode.get(id) ?? []);
    if (sourceWays.length === 0) return true;
    const reference = survivorWays.length > 0 ? survivorWays : [sourceWays[0]!];
    if (!sourceWays.every((way) => reference.some((other) => wayPairJoinable(way, other)))) {
      return false;
    }
    // Every source joins one survivor: the whole resulting junction must pass final validation.
    const rewritten = [...survivorWays, ...sourceWays].map((way) => ({
      ...way,
      refs: way.refs.map((ref) => (group.includes(ref) ? survivorId : ref)),
    }));
    return !junctionHasIncompatibleGrades(survivorId, [
      ...new Map(rewritten.map((way) => [way.id, way])).values(),
    ]);
  }

  /**
   * Relation node members follow a merged node. A turn restriction must stay valid after that:
   * drop any replacement that would break one (MP-X1), before anything is rewritten.
   */
  private removeRestrictionBreakingNodeReplacements(replacementMap: ReplacementMap) {
    if (replacementMap.size === 0) return;
    let changed = true;
    while (changed) {
      changed = false;
      for (const relation of this.currentRelations()) {
        if (relation.tags?.["type"] !== "restriction") continue;
        const replaced = relation.members.filter(
          (member) => member.type === "node" && replacementMap.has(member.ref),
        );
        if (replaced.length === 0) continue;
        const proposed = {
          ...relation,
          members: relation.members.map((member) =>
            member.type === "node" && replacementMap.has(member.ref)
              ? { ...member, ref: replacementMap.get(member.ref)! }
              : member,
          ),
        };
        const issues = restrictionTopologyIssues(proposed, (id) => {
          const stored = this.wayChanges[id]?.entity ?? this.osm.ways.getById(id);
          const way = stored ? this.getCurrentWay(stored) : null;
          if (!way) return null;
          return { ...way, refs: way.refs.map((ref) => replacementMap.get(ref) ?? ref) };
        });
        if (issues.length === 0) continue;
        for (const member of replaced) replacementMap.delete(member.ref);
        changed = true;
      }
    }
  }

  private reconcileNodeTags(patchNode: OsmNode, baseNodeId: number) {
    const baseNode = this.getCurrentNode(baseNodeId);
    if (!baseNode) return;
    const mergedNode = this.withMergedTags(baseNode, patchNode);
    if (mergedNode !== baseNode) this.modify("node", baseNodeId, () => mergedNode);
  }

  /**
   * The survivor with `source`'s tags merged in. An imported source's values win (MP-X1);
   * within one dataset only values the survivor lacks are added.
   */
  private withMergedTags(survivor: OsmNode, source: OsmNode): OsmNode {
    if (this.nodeChanges[source.id]?.changeType !== "create") {
      return withNonConflictingTags(survivor, source);
    }
    const tags = mergeImportedTags(survivor.tags, source.tags);
    const same =
      Object.keys(tags).length === Object.keys(survivor.tags ?? {}).length &&
      Object.entries(tags).every(([key, value]) => survivor.tags?.[key] === value);
    return same ? survivor : { ...survivor, tags };
  }

  private deleteReconciledNode(node: OsmNode, survivorId: number) {
    const pendingChange = this.nodeChanges[node.id];
    if (pendingChange?.changeType === "create") {
      this.overlay.discard("node", node.id);
    } else {
      const storedNode = this.osm.nodes.getById(node.id);
      if (!storedNode) return;
      this.delete(storedNode, [{ type: "node", id: survivorId, osmId: this.osm.id }]);
    }
    this.deduplicatedNodes++;
  }

  /**
   * Reconcile incoming nodes with unambiguous base nodes at the exact OSM coordinate.
   * Cross-dataset reconciliation always preserves the base ID. Same-dataset deduplication
   * uses the highest compatible ID as a deterministic survivor.
   */
  deduplicateNodes(nodes: Nodes) {
    const replacementMap = this.planNodeReplacements(nodes);
    this.applyNodeReplacements(replacementMap);
    return replacementMap;
  }

  /**
   * @internal The safe exact node replacements for `nodes` (source ID to survivor ID), without
   * recording them. Any subset of the result is also safe to apply. `reviewReasons` receives,
   * by source ID, why a replacement needs a person first (`grade-change`, MP-X1).
   */
  planNodeReplacements(nodes: Nodes, reviewReasons?: Map<number, string[]>): ReplacementMap {
    const sameDataset = nodes === this.osm.nodes;
    let replacementMap: ReplacementMap = new Map();
    const exactCandidates: NodeCandidate[] = [];
    const contextNodeIds = new Set<number>();

    for (const patchNode of nodes) {
      if (this.nodeChanges[patchNode.id]?.changeType === "delete") continue;
      if (!sameDataset && this.nodeChanges[patchNode.id]?.changeType !== "create") continue;
      const currentPatchNode = this.getCurrentNode(patchNode.id);
      if (!currentPatchNode) continue;

      // Exact reconciliation only accepts equality at OSM's seven-decimal storage
      // precision. Query that exact coordinate rather than calculating and sorting
      // haversine distances for candidates that could never be accepted.
      const candidateNodes = this.osm.nodes
        .findIndexesWithinBbox([patchNode.lon, patchNode.lat, patchNode.lon, patchNode.lat])
        .map((index) => this.osm.nodes.getByIndex(index))
        .map((baseNode) => this.getCurrentNode(baseNode.id) ?? baseNode)
        .filter(
          (baseNode) =>
            baseNode.id !== patchNode.id &&
            (!sameDataset || baseNode.id > patchNode.id) &&
            this.nodeChanges[baseNode.id]?.changeType !== "delete" &&
            sameOsmCoordinate(currentPatchNode, baseNode) &&
            assessNodeTags("exact", currentPatchNode.tags, baseNode.tags, {
              sourceIsImported: !sameDataset,
            }).hardReasons.length === 0,
        );
      if (reviewReasons && candidateNodes.length === 1) {
        const { reviewReasons: reasons } = assessNodeTags(
          "exact",
          currentPatchNode.tags,
          candidateNodes[0]!.tags,
          { sourceIsImported: !sameDataset },
        );
        if (reasons.length > 0) reviewReasons.set(currentPatchNode.id, reasons);
      }

      if (candidateNodes.length === 0) continue;
      exactCandidates.push({ baseNodes: candidateNodes, patchNode: currentPatchNode });
      contextNodeIds.add(currentPatchNode.id);
      for (const baseNode of candidateNodes) contextNodeIds.add(baseNode.id);
    }

    if (exactCandidates.length === 0) return replacementMap;

    const waysByNode = this.currentWaysByNode(contextNodeIds);
    for (const { baseNodes, patchNode } of exactCandidates) {
      const compatibleNodes = baseNodes.filter((baseNode) =>
        this.nodeContextsCompatible(patchNode, baseNode, waysByNode, sameDataset),
      );
      if (compatibleNodes.length === 0 || (!sameDataset && compatibleNodes.length !== 1)) continue;
      const baseNode = sameDataset
        ? compatibleNodes.toSorted((a, b) => b.id - a.id)[0]
        : compatibleNodes[0];
      replacementMap.set(patchNode.id, baseNode!.id);
    }

    if (replacementMap.size === 0) return replacementMap;
    replacementMap = flattenReplacementMap(replacementMap);
    this.removeConflictingNodeReplacements(replacementMap, waysByNode);
    this.removeUnsafeNodeReplacements(replacementMap);
    this.removeRestrictionBreakingNodeReplacements(replacementMap);
    return replacementMap;
  }

  /** @internal Record exact node replacements from `planNodeReplacements`. */
  applyNodeReplacements(replacementMap: ReplacementMap) {
    if (replacementMap.size === 0) return;
    this.applyNodeReplacementsToWays(replacementMap);
    this.applyNodeReplacementsToRelations(replacementMap);

    for (const [patchNodeId, baseNodeId] of replacementMap) {
      const patchNode = this.getCurrentNode(patchNodeId);
      if (!patchNode) continue;
      this.reconcileNodeTags(patchNode, baseNodeId);
      this.deleteReconciledNode(patchNode, baseNodeId);
    }
  }

  /**
   * Apply node replacements to all ways in the OSM dataset.
   * Returns the total number of node references replaced.
   */
  private applyNodeReplacementsToWays(replacementMap: Map<number, number>): number {
    if (replacementMap.size === 0) return 0;
    let replacedCount = 0;

    for (const way of this.currentWays()) {
      let hasReplacement = false;
      const newRefs = way.refs.map((ref) => {
        const replacement = replacementMap.get(ref);
        if (replacement !== undefined) {
          hasReplacement = true;
          replacedCount++;
          return replacement;
        }
        return ref;
      });

      if (hasReplacement) {
        this.modify("way", way.id, (way) =>
          removeDuplicateAdjacentWayRefs({
            ...way,
            refs: newRefs,
          }),
        );
      }
    }

    this.deduplicatedNodesReplaced += replacedCount;
    return replacedCount;
  }

  /**
   * Apply node replacements to all relations in the OSM dataset.
   * Returns the total number of node member references replaced.
   */
  private applyNodeReplacementsToRelations(replacementMap: Map<number, number>): number {
    if (replacementMap.size === 0) return 0;
    let replacedCount = 0;

    for (const relation of this.currentRelations()) {
      let hasReplacement = false;
      const newMembers = relation.members.map((member) => {
        if (member.type !== "node") return member;
        const replacement = replacementMap.get(member.ref);
        if (replacement !== undefined) {
          hasReplacement = true;
          replacedCount++;
          return { ...member, ref: replacement };
        }
        return member;
      });

      if (hasReplacement) {
        this.modify("relation", relation.id, (relation) =>
          removeDuplicateAdjacentRelationMembers({
            ...relation,
            members: newMembers,
          }),
        );
      }
    }

    this.deduplicatedNodesReplaced += replacedCount;
    return replacedCount;
  }

  private incidentWaysAtNode(nodeId: number) {
    return this.overlay.waysAtNode(nodeId);
  }

  private planIntersectionNodeReplacement(replaced: OsmNode, survivor: OsmNode) {
    const incidentWays = this.incidentWaysAtNode(replaced.id);
    const incidentIds = new Set(incidentWays.map((way) => way.id));
    const affectedRestrictions = [...this.currentRelations()].filter(
      (relation) =>
        relation.tags?.["type"] === "restriction" &&
        relation.members.some((member) =>
          member.type === "way"
            ? incidentIds.has(member.ref)
            : member.type === "node" && member.role === "via" && member.ref === replaced.id,
        ),
    );
    const plan: {
      replacement: IntersectionJunctionReplacement | null;
      canCreateDedicatedIntersection: boolean;
    } = {
      replacement: null,
      canCreateDedicatedIntersection:
        incidentWays.length === 1 && affectedRestrictions.length === 0,
    };
    if (
      incidentWays.some((way) =>
        this.intersectionReplacementIsUnsafe(way, replaced.id, survivor.id),
      )
    ) {
      return plan;
    }
    const rewrittenWays = incidentWays.map((way) => ({
      ...way,
      refs: way.refs.map((ref) => (ref === replaced.id ? survivor.id : ref)),
    }));
    const combinedWays = new Map(this.incidentWaysAtNode(survivor.id).map((way) => [way.id, way]));
    for (const way of rewrittenWays) combinedWays.set(way.id, way);
    if (junctionHasIncompatibleGrades(survivor.id, [...combinedWays.values()])) return plan;

    const restrictions: OsmRelation[] = [];
    for (const relation of affectedRestrictions) {
      let changed = false;
      const proposed = {
        ...relation,
        members: relation.members.map((member) => {
          if (member.type !== "node" || member.role !== "via" || member.ref !== replaced.id)
            return member;
          changed = true;
          return { ...member, ref: survivor.id };
        }),
      };
      const issues = restrictionTopologyIssues(proposed, (id) => {
        const change = this.wayChanges[id];
        if (change?.changeType === "delete") return null;
        return combinedWays.get(id) ?? change?.entity ?? this.osm.ways.getById(id);
      });
      if (issues.length > 0) return plan;
      if (changed) restrictions.push(proposed);
    }
    plan.replacement = { ways: rewrittenWays, restrictions };
    return plan;
  }

  private chooseIntersectionNode(
    wayNode: OsmNode,
    intersectingWayNode: OsmNode,
    wayIsPatch: boolean,
    intersectingWayIsPatch: boolean,
    patchNodeIds: { has(id: number): boolean } | undefined,
  ): IntersectionNodeResolution | "keep-both" | null {
    const imported = (id: number) => patchNodeIds?.has(id) ?? false;
    // A survivor-to-be that is imported cannot be told apart from base here without patch IDs;
    // check whichever direction adds tags to existing data.
    const [importedNode, existingNode] = imported(wayNode.id)
      ? [wayNode, intersectingWayNode]
      : [intersectingWayNode, wayNode];
    const oneImported = imported(wayNode.id) !== imported(intersectingWayNode.id);
    const tagAssessment = assessNodeTags("crossing", importedNode.tags, existingNode.tags, {
      sourceIsImported: oneImported,
    });
    if (tagAssessment.hardReasons.length) return null;
    const reviewReasons = tagAssessment.reviewReasons.length
      ? { reviewReasons: [...tagAssessment.reviewReasons] }
      : {};
    // Never merge two base nodes: that would remove a base node from base ways.
    if (
      patchNodeIds &&
      !patchNodeIds.has(wayNode.id) &&
      !patchNodeIds.has(intersectingWayNode.id)
    ) {
      return "keep-both";
    }
    // A base node always survives a crossing snap.
    if (patchNodeIds && patchNodeIds.has(wayNode.id) !== patchNodeIds.has(intersectingWayNode.id)) {
      const keepWayNode = !patchNodeIds.has(wayNode.id);
      return keepWayNode
        ? { keepWayNode, replaced: intersectingWayNode, survivor: wayNode, ...reviewReasons }
        : { keepWayNode, replaced: wayNode, survivor: intersectingWayNode, ...reviewReasons };
    }

    const wayRoutingTags = nodeRoutingTagCount(wayNode);
    const intersectingRoutingTags = nodeRoutingTagCount(intersectingWayNode);
    let keepWayNode: boolean;
    if (wayIsPatch !== intersectingWayIsPatch) {
      keepWayNode = !wayIsPatch;
    } else if (wayRoutingTags !== intersectingRoutingTags) {
      keepWayNode = wayRoutingTags > intersectingRoutingTags;
    } else {
      const wayTagCount = Object.keys(wayNode.tags ?? {}).length;
      const intersectingTagCount = Object.keys(intersectingWayNode.tags ?? {}).length;
      keepWayNode = wayTagCount >= intersectingTagCount;
    }

    const survivor = keepWayNode ? wayNode : intersectingWayNode;
    const replaced = keepWayNode ? intersectingWayNode : wayNode;
    return { keepWayNode, replaced, survivor, ...reviewReasons };
  }

  /**
   * Every incident way must survive a proposed endpoint substitution. Reject
   * collapsing or adjacent duplicate refs before mutating any part of the junction.
   */
  private intersectionReplacementIsUnsafe(
    way: OsmWay,
    replacedNodeId: number,
    survivorNodeId: number,
  ) {
    const refs = way.refs.map((ref) => (ref === replacedNodeId ? survivorNodeId : ref));
    return refsWouldCollapse(refs);
  }

  /**
   * Drop an imported point a junction replacement left unused (MP-J1). Its tags were merged into
   * the survivor and every way was rewritten, so only an imported point used by patch ways alone,
   * and by no relation, goes; base points and still-referenced ones stay.
   */
  private dropReplacedIntersectionNode(
    replaced: OsmNode,
    survivorId: number,
    patchNodeIds: { has(id: number): boolean } | undefined,
  ) {
    const referencedByRelation = [...this.currentRelations()].some((relation) =>
      relation.members.some((member) => member.type === "node" && member.ref === replaced.id),
    );
    const droppable = canDropReplacedNode({
      imported: patchNodeIds?.has(replaced.id) ?? false,
      tagged: Object.keys(replaced.tags ?? {}).length > 0,
      tagsMerged: mergesTags("crossing"),
      // The replacement rewrote every incident way, so no way still uses the replaced node.
      referencedByWay: false,
      referencedByRelation,
    });
    if (!droppable) return;
    // On a plan the imported node is still a pending create; forget it instead.
    if (this.nodeChanges[replaced.id]?.changeType === "create") {
      this.overlay.discard("node", replaced.id);
    } else {
      const storedNode = this.osm.nodes.getById(replaced.id);
      if (!storedNode) return;
      this.delete(storedNode, [{ type: "node", id: survivorId, osmId: this.osm.id }]);
    }
    this.intersectionNodesRemoved++;
  }

  private mergeNodeTags(survivor: OsmNode, replaced: OsmNode) {
    const merged = this.withMergedTags(survivor, replaced);
    if (merged !== survivor) this.modify("node", survivor.id, () => merged);
    return merged;
  }

  /**
   * Tag a node both ways pass through with a default `crossing=yes`. A node where either way
   * ends is a junction, such as one path continuing another or meeting it, not a crossing.
   */
  private markNodeAsCrossing(nodeId: number, wayId: number, otherWayId: number) {
    for (const id of [wayId, otherWayId]) {
      const way = this.overlay.getWay(id);
      if (!way || wayEndsAt(way, nodeId)) return;
    }
    const node = this.getCurrentNode(nodeId);
    // Intersection discovery can supply a missing default, but must not erase
    // a specific crossing value supplied by the base or an earlier tag copy.
    if (!node || node.tags?.["crossing"] != null) return;
    this.modify("node", node.id, (node) => ({
      ...node,
      tags: { ...node.tags, crossing: "yes" },
    }));
  }

  /**
   * De-duplicate the ways within this OSM changeset.
   */
  /**
   * @param accept - Called with each exact way match; returning false leaves the pair
   * separate. Every match is accepted without it.
   */
  *deduplicateWaysGenerator(
    ways: Ways,
    replacementMap: ReplacementMap = new Map(),
    accept?: (patchWayId: number, baseWayId: number) => boolean,
  ) {
    const dedupedIdPairs = new IdPairs();
    const sameDataset = ways === this.osm.ways;
    const exactWayIndex = sameDataset ? undefined : this.buildCrossDatasetExactWayIndex();
    for (const way of ways) {
      if (this.wayChanges[way.id]?.changeType === "delete") continue;
      yield this.deduplicateWayAgainstBase(
        way,
        sameDataset,
        dedupedIdPairs,
        replacementMap,
        exactWayIndex,
        accept,
      );
    }
  }

  /**
   * Index immutable base targets by ordered refs and routing semantics. Candidate
   * buckets are collision-checked with the complete reconciliation predicates.
   */
  private buildCrossDatasetExactWayIndex(): ExactWayIndex {
    const index: ExactWayIndex = new Map();
    for (let wayIndex = 0; wayIndex < this.osm.ways.size; wayIndex++) {
      const currentWay = this.getCurrentWay(this.osm.ways.getByIndex(wayIndex));
      if (!currentWay) continue;
      const hash = exactWayHash(currentWay);
      const indexed = index.get(hash);
      if (indexed === undefined) index.set(hash, wayIndex);
      else if (typeof indexed === "number") index.set(hash, [indexed, wayIndex]);
      else indexed.push(wayIndex);
    }
    return index;
  }

  deduplicateWays(ways: Ways) {
    const replacementMap: ReplacementMap = new Map();
    for (const _ of this.deduplicateWaysGenerator(ways, replacementMap));
    return flattenReplacementMap(replacementMap);
  }

  /**
   * Apply way replacements to all relation members in the OSM dataset.
   * Returns the total number of way member references replaced.
   */
  private applyWayReplacementsToRelations(replacementMap: ReplacementMap): number {
    if (replacementMap.size === 0) return 0;
    let replacedCount = 0;

    for (const relation of this.currentRelations()) {
      let hasReplacement = false;
      const newMembers = relation.members.map((member) => {
        if (member.type !== "way") return member;
        const replacement = resolveReplacement(member.ref, replacementMap);
        if (replacement !== member.ref) {
          hasReplacement = true;
          replacedCount++;
          return { ...member, ref: replacement };
        }
        return member;
      });

      if (hasReplacement) {
        this.modify("relation", relation.id, (relation) =>
          removeDuplicateAdjacentRelationMembers({
            ...relation,
            members: newMembers,
          }),
        );
      }
    }

    return replacedCount;
  }

  private deleteReconciledWay(way: OsmWay, survivorId: number) {
    const pendingChange = this.wayChanges[way.id];
    if (pendingChange?.changeType === "create") {
      this.overlay.discard("way", way.id);
    } else {
      const storedWay = this.osm.ways.getById(way.id);
      if (!storedWay) return;
      this.delete(storedWay, [{ type: "way", id: survivorId, osmId: this.osm.id }]);
    }
    this.deduplicatedWays++;
  }

  private deduplicateWayAgainstBase(
    patchWay: OsmWay,
    sameDataset: boolean,
    dedupedIdPairs: IdPairs,
    replacementMap: ReplacementMap,
    exactWayIndex?: ExactWayIndex,
    accept?: (patchWayId: number, baseWayId: number) => boolean,
  ) {
    if (!this.osm.ways.ids.has(patchWay.id) && this.wayChanges[patchWay.id] == null) return 0;
    if (!sameDataset && this.wayChanges[patchWay.id]?.changeType !== "create") return 0;
    const currentPatchWay =
      this.getCurrentWay(patchWay) ?? this.wayChanges[patchWay.id]?.entity ?? patchWay;
    const indexed = exactWayIndex?.get(exactWayHash(currentPatchWay));
    if (exactWayIndex && indexed === undefined) return 0;
    const indexedCandidates =
      typeof indexed === "number" ? [indexed] : indexed === undefined ? [] : indexed;

    const wayCoords = this.getWayCoordinates(currentPatchWay);
    if (!wayCoords || wayCoords.length < 2) return 0;

    const patchBbox = wayBbox(wayCoords);
    const closeWayIndexes = exactWayIndex
      ? indexedCandidates.filter((index) =>
          bboxesIntersect(patchBbox, this.osm.ways.getEntityBbox({ index })),
        )
      : this.osm.ways.intersects(patchBbox);
    const candidates = closeWayIndexes
      .map((index) => this.osm.ways.getByIndex(index))
      .filter((baseWay) => {
        if (baseWay.id === patchWay.id) return false;
        if (sameDataset) {
          if (baseWay.id < patchWay.id) return false;
        }
        if (dedupedIdPairs.has(patchWay.id, baseWay.id)) return false;
        dedupedIdPairs.add(patchWay.id, baseWay.id);
        const currentBaseWay = this.getCurrentWay(baseWay);
        if (!currentBaseWay) return false;
        if (!dequal(currentPatchWay.refs, currentBaseWay.refs)) return false;
        return routingSemanticTagsEqual(currentPatchWay.tags, currentBaseWay.tags);
      });

    if (candidates.length === 0 || (!sameDataset && candidates.length !== 1)) return 0;
    const baseWay = sameDataset ? candidates.toSorted((a, b) => b.id - a.id)[0] : candidates[0];
    const currentBaseWay = this.getCurrentWay(baseWay!);
    if (!currentBaseWay) return 0;
    if (accept && !accept(patchWay.id, currentBaseWay.id)) return 0;

    const mergedWay = withNonConflictingDescriptiveTags(currentBaseWay, currentPatchWay);
    if (mergedWay !== currentBaseWay) this.modify("way", currentBaseWay.id, () => mergedWay);

    replacementMap.set(patchWay.id, currentBaseWay.id);
    this.applyWayReplacementsToRelations(replacementMap);
    this.deleteReconciledWay(patchWay, currentBaseWay.id);
    return 1;
  }

  /** Reconcile one incoming way with a unique, equivalent base way. */
  deduplicateWay(
    patchWay: OsmWay,
    dedupedIdPairs: IdPairs,
    replacementMap: ReplacementMap = new Map(),
  ) {
    return this.deduplicateWayAgainstBase(
      patchWay,
      this.osm.ways.ids.has(patchWay.id),
      dedupedIdPairs,
      replacementMap,
    );
  }

  /**
   * Generator that creates intersection nodes for ways that cross each other.
   * Yields statistics for each way processed, including intersection points found and nodes created.
   *
   * Candidate ways come from the base dataset's spatial index; use it when the base already
   * contains the ways to process.
   *
   * @param ways - The ways to process for intersections
   * @yields Statistics object with `intersectionsFound` and `intersectionsCreated` counts
   */
  *createIntersectionsForWaysGenerator(ways: Ways, patchNodeIds?: { has(id: number): boolean }) {
    yield* this.createIntersections(ways, this.osmCrossingSearch(), patchNodeIds);
  }

  createIntersectionsForWays(ways: Ways, patchNodeIds?: { has(id: number): boolean }) {
    for (const _ of this.createIntersectionsForWaysGenerator(ways, patchNodeIds));
  }

  /**
   * @internal Insert crossings for `ways` found on the planned state: the base plus every
   * pending change, read through the overlay as it stood when this call began. `accept` can
   * skip individual crossings.
   */
  *createPlannedIntersections(
    ways: Ways,
    patchNodeIds: { has(id: number): boolean },
    accept?: (crossing: CrossingInsertion) => boolean,
    /** The planned state now, read-only, when the caller holds one; otherwise a copy. */
    start?: PlanOverlay,
  ) {
    // New crossing nodes are new entities, so they get negative IDs, below every node the
    // planned state holds.
    this.currentNodeId = this.overlay.minNodeId();
    this.nodeIdStep = -1;
    // A patch node with a base node's ID edits that base node (MP-I1); it is not imported.
    const importedNodeIds = {
      has: (id: number) => patchNodeIds.has(id) && !this.osm.nodes.ids.has(id),
    };
    yield* this.createIntersections(
      ways,
      this.overlayCrossingSearch(start ?? this.overlay.snapshot()),
      importedNodeIds,
      accept,
    );
  }

  private *createIntersections(
    ways: Ways,
    search: CrossingSearch,
    patchNodeIds?: { has(id: number): boolean },
    accept?: (crossing: CrossingInsertion) => boolean,
  ) {
    const wayIdPairs = new IdPairs();
    const patchWayIds = new Set<number>();
    for (const way of ways) patchWayIds.add(way.id);
    const grades = new Map<number, string | null>();
    for (const way of ways) {
      // Yield once per input way so callers can report complete progress even
      // when exact reconciliation already removed an equivalent patch way.
      if (!search.startBbox(way.id)) {
        yield;
        continue;
      }
      yield this.createIntersectionsForWayInternal(
        way.id,
        wayIdPairs,
        patchWayIds,
        search,
        grades,
        patchNodeIds,
        accept,
      );
    }
  }

  private osmCrossingSearch(): CrossingSearch {
    return {
      startBbox: (wayId) => {
        const [index] = this.osm.ways.ids.idOrIndex({ id: wayId });
        return index < 0 ? null : this.osm.ways.getEntityBbox({ index });
      },
      // ID order keeps crossing node IDs independent of the spatial index's layout.
      near: (bbox) =>
        this.osm.ways
          .intersects(bbox)
          .map((index) => this.osm.ways.ids.at(index))
          .sort((a, b) => a - b),
    };
  }

  private overlayCrossingSearch(start: PlanOverlay): CrossingSearch {
    const cache = this.crossingCache;
    cache.begin(start);
    return {
      startBbox: (wayId) => {
        const way = start.getWay(wayId);
        return way ? start.wayBbox(way) : null;
      },
      near: (bbox, wayId) => cache.nearWays(wayId, bbox, (box) => start.wayIdsIntersecting(box)),
      intersect: (wayId, line, otherId, other) =>
        cache.crossingPoints(wayId, line, otherId, other, waysIntersect),
    };
  }

  /**
   * A way's grade signature when it can take a new crossing, or null when it cannot. Crossing
   * insertion rewrites refs only, so tags, and this, are fixed for the whole pass.
   */
  private crossingGrade(wayId: number, grades: Map<number, string | null>) {
    if (grades.has(wayId)) return grades.get(wayId)!;
    const tags = this.overlay.getWay(wayId)?.tags;
    const grade = areWayTagsIntersectionCandidate(tags) ? routingGradeSignature(tags) : null;
    grades.set(wayId, grade);
    return grade;
  }

  private getCurrentWay(way: OsmWay): OsmWay | null {
    return this.overlay.currentWay(way);
  }

  private getCurrentNode(id: number): OsmNode | null {
    return this.overlay.getNode(id);
  }

  /**
   * Resolve way coordinates from the base dataset plus pending node changes.
   * Returns null when any ref is genuinely unavailable instead of substituting geometry.
   */
  private getWayCoordinates(way: OsmWay): [number, number][] | null {
    return this.overlay.wayCoordinates(way);
  }

  private getCleanWayCoordinates(way: OsmWay): [number, number][] | null {
    return this.overlay.cleanWayCoordinates(way);
  }

  /**
   * Create intersections for a single way.
   * - Finds other ways that intersect the given way's bounding box.
   * - Checks if they should connect (e.g. both are highways/paths, not tunnels/bridges).
   * - Calculates intersection points.
   * - Inserts existing nodes or creates new intersection nodes at the crossing points.
   */
  private createIntersectionsForWayInternal(
    wayId: number,
    wayIdPairs: IdPairs,
    patchWayIds: ReadonlySet<number>,
    search: CrossingSearch,
    grades: Map<number, string | null>,
    patchNodeIds?: { has(id: number): boolean },
    accept?: (crossing: CrossingInsertion) => boolean,
  ) {
    let intersectionsFound = 0;
    let intersectionsCreated = 0;

    const initialGrade = this.crossingGrade(wayId, grades);
    if (initialGrade == null) return;
    const initialWay = this.overlay.getWay(wayId);
    if (!initialWay) return;

    const initialWayCoordinates = this.getWayCoordinates(initialWay);
    if (!initialWayCoordinates || initialWayCoordinates.length < 2) return;

    const bbox = search.startBbox(wayId);
    if (!bbox) return;
    const intersectingWayIds = search.near(bbox, wayId).filter((intersectingWayId) => {
      if (intersectingWayId === initialWay.id) return false;
      if (wayIdPairs.has(initialWay.id, intersectingWayId)) return false;

      // The old loop recorded every spatial pair before checking routing and
      // grade compatibility. Keep that side effect while avoiding entity and
      // coordinate work for pairs that can never connect.
      if (this.crossingGrade(intersectingWayId, grades) !== initialGrade) {
        wayIdPairs.add(initialWay.id, intersectingWayId);
        return false;
      }
      return true;
    });
    if (intersectingWayIds.length === 0) return;

    for (const intersectingWayId of intersectingWayIds) {
      if (wayIdPairs.has(initialWay.id, intersectingWayId)) continue;
      wayIdPairs.add(initialWay.id, intersectingWayId);

      // Skip ways that aren't applicable for connecting
      const way = this.overlay.getWay(wayId);
      const intersectingWay = this.overlay.getWay(intersectingWayId);
      if (!way || !intersectingWay) continue;
      if (!waysShouldConnect(way.tags, intersectingWay.tags)) continue;

      const wayCoordinates = this.getWayCoordinates(way);
      const intersectingWayCoordinates = this.getWayCoordinates(intersectingWay);
      if (
        !wayCoordinates ||
        wayCoordinates.length < 2 ||
        !intersectingWayCoordinates ||
        intersectingWayCoordinates.length < 2
      ) {
        continue;
      }
      const coordinates = this.getCleanWayCoordinates(way);
      const intersectingWayCoords = this.getCleanWayCoordinates(intersectingWay);
      if (!coordinates || !intersectingWayCoords) continue;

      // Skip ways that are geometrically equal
      if (dequal(coordinates, intersectingWayCoords)) continue;

      const intersectingPoints = search.intersect
        ? search.intersect(wayId, coordinates, intersectingWayId, intersectingWayCoords)
        : waysIntersect(coordinates, intersectingWayCoords);
      for (const pt of intersectingPoints) {
        const currentWay = this.overlay.getWay(wayId);
        // Reuse the already decoded base entity; getCurrentWay still selects any
        // pending rewrite made by an earlier point in this same pair.
        const currentIntersectingWay = this.getCurrentWay(intersectingWay);
        if (!currentWay || !currentIntersectingWay) continue;
        const currentWayCoordinates = this.getWayCoordinates(currentWay);
        const currentIntersectingWayCoordinates = this.getWayCoordinates(currentIntersectingWay);
        if (!currentWayCoordinates || !currentIntersectingWayCoordinates) continue;

        const intersectingWayNodeId = nearestNodeOnWay(
          currentIntersectingWay,
          currentIntersectingWayCoordinates,
          pt,
        ).nodeId;
        const wayNodeId = nearestNodeOnWay(currentWay, currentWayCoordinates, pt).nodeId;

        // If both ways already share the same node at this intersection,
        // just add the crossing tag (if needed) but don't count as an intersection.
        if (
          wayNodeId != null &&
          intersectingWayNodeId != null &&
          wayNodeId === intersectingWayNodeId
        ) {
          this.markNodeAsCrossing(wayNodeId, currentWay.id, currentIntersectingWay.id);
          continue;
        }

        let endpointResolution: IntersectionNodeResolution | undefined;
        let junctionReplacement: IntersectionJunctionReplacement | null = null;
        let createDedicatedIntersection = false;
        let spliceIntersectingWayNode = false;
        if (wayNodeId != null && intersectingWayNodeId != null) {
          const wayNode = this.getCurrentNode(wayNodeId);
          const intersectingWayNode = this.getCurrentNode(intersectingWayNodeId);
          if (!wayNode || !intersectingWayNode) continue;
          const choice = this.chooseIntersectionNode(
            wayNode,
            intersectingWayNode,
            patchWayIds.has(currentWay.id),
            patchWayIds.has(currentIntersectingWay.id),
            patchNodeIds,
          );
          if (!choice) continue;
          if (choice === "keep-both") {
            // Two base nodes both stay: the imported way takes the other way's vertex, unless
            // that vertex sits on one of its own and would leave a zero-length segment.
            const { lon, lat } = intersectingWayNode;
            if (currentWayCoordinates.some(([x, y]) => x === lon && y === lat)) continue;
            spliceIntersectingWayNode = true;
          } else {
            endpointResolution = choice;
            const plan = this.planIntersectionNodeReplacement(choice.replaced, choice.survivor);
            junctionReplacement = plan.replacement;
            if (!junctionReplacement) {
              // A shared junction must remain intact if even one incident way or
              // restriction cannot follow the replacement. The isolated short-way
              // fallback can still insert the geometric intersection independently.
              if (!plan.canCreateDedicatedIntersection) continue;
              endpointResolution = undefined;
              createDedicatedIntersection = true;
            }
          }
        }

        const snaps =
          (endpointResolution && junctionReplacement) ||
          (!createDedicatedIntersection && (wayNodeId != null || intersectingWayNodeId != null));
        const insertion: CrossingInsertion = {
          kind: snaps ? "snap" : "node",
          wayId: currentWay.id,
          otherWayId: currentIntersectingWay.id,
          point: pt,
          ...(endpointResolution && junctionReplacement
            ? {
                merges: {
                  replaced: endpointResolution.replaced.id,
                  survivor: endpointResolution.survivor.id,
                },
                ...(endpointResolution.reviewReasons
                  ? { reviewReasons: endpointResolution.reviewReasons }
                  : {}),
              }
            : {}),
        };
        // Without a plan to review it in, a snap that needs a person does not happen.
        if (accept ? !accept(insertion) : insertion.reviewReasons?.length) continue;

        intersectionsFound++;

        if (endpointResolution && junctionReplacement) {
          const survivor = this.mergeNodeTags(
            endpointResolution.survivor,
            endpointResolution.replaced,
          );
          for (const way of junctionReplacement.ways) {
            this.modify("way", way.id, () => way);
          }
          for (const relation of junctionReplacement.restrictions) {
            this.modify("relation", relation.id, () => relation);
          }
          this.markNodeAsCrossing(survivor.id, currentWay.id, currentIntersectingWay.id);
          this.dropReplacedIntersectionNode(endpointResolution.replaced, survivor.id, patchNodeIds);
        } else if (createDedicatedIntersection) {
          intersectionsCreated++;
          const newIntersectionNode = this.createIntersectionNode(
            currentWay,
            currentIntersectingWay,
            pt,
          );
          this.spliceNodeIntoWay(currentWay, newIntersectionNode);
          this.spliceNodeIntoWay(currentIntersectingWay, newIntersectionNode);
        } else if (wayNodeId != null && !spliceIntersectingWayNode) {
          const wayNode = this.getCurrentNode(wayNodeId);
          if (wayNode == null) throw Error(`Way node ${String(wayNodeId)} not found`);
          this.spliceNodeIntoWay(currentIntersectingWay, wayNode);
          this.markNodeAsCrossing(wayNode.id, currentWay.id, currentIntersectingWay.id);
        } else if (intersectingWayNodeId != null) {
          const intersectingWayNode = this.getCurrentNode(intersectingWayNodeId);
          if (intersectingWayNode == null)
            throw Error(`Intersecting way node ${String(intersectingWayNodeId)} not found`);

          this.spliceNodeIntoWay(currentWay, intersectingWayNode);
          this.markNodeAsCrossing(intersectingWayNode.id, currentWay.id, currentIntersectingWay.id);
        } else {
          intersectionsCreated++;
          const newIntersectionNode = this.createIntersectionNode(
            currentWay,
            currentIntersectingWay,
            pt,
          );
          this.spliceNodeIntoWay(currentWay, newIntersectionNode);
          this.spliceNodeIntoWay(currentIntersectingWay, newIntersectionNode);
        }
      }
    }

    this.intersectionPointsFound += intersectionsFound;
    this.intersectionNodesCreated += intersectionsCreated;

    return {
      intersectionsFound,
      intersectionsCreated,
    };
  }

  private createIntersectionNode(
    way: OsmWay,
    intersectingWay: OsmWay,
    point: [number, number],
  ): OsmNode {
    const node: OsmNode = {
      id: this.nextNodeId(),
      lon: point[0],
      lat: point[1],
      tags: {
        crossing: "yes",
      },
    };
    // The new maximum ID cannot be referenced by existing base ways, so adding
    // it does not invalidate any cached geometry until each way is spliced.
    this.overlay.create(
      node,
      this.osm.id,
      [
        { type: "way", id: way.id, osmId: this.osm.id },
        { type: "way", id: intersectingWay.id, osmId: this.osm.id },
      ],
      { unreferenced: true },
    );
    return node;
  }

  /**
   * We do not pass coordinates here because the way may have already been modified.
   */
  spliceNodeIntoWay(way: OsmWay, node: OsmNode) {
    const currentWay = this.getCurrentWay(way);
    if (!currentWay) return;
    const coordinates = this.getWayCoordinates(currentWay);
    if (!coordinates || coordinates.length < 2 || currentWay.refs.includes(node.id)) return;

    let closestSegment = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < coordinates.length - 1; index++) {
      const start = coordinates[index]!;
      const end = coordinates[index + 1]!;
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared === 0) continue;
      const projection = ((node.lon - start[0]) * dx + (node.lat - start[1]) * dy) / lengthSquared;
      const parameter = Math.max(0, Math.min(1, projection));
      const projectedLon = start[0] + parameter * dx;
      const projectedLat = start[1] + parameter * dy;
      const distance = (node.lon - projectedLon) ** 2 + (node.lat - projectedLat) ** 2;
      if (distance >= closestDistance) continue;
      closestDistance = distance;
      closestSegment = index;
    }
    if (closestSegment < 0) return;
    this.modify("way", way.id, (way) => ({
      ...way,
      refs: way.refs.toSpliced(closestSegment + 1, 0, node.id),
    }));
  }

  /**
   * Create direct same-ID modifications and new-entity changes from a patch OSM file.
   *
   * Implementation notes:
   * - Ways are processed before nodes so subsequent node reconciliation can inspect pending ways.
   * - Call `deduplicateNodes()` and `deduplicateWays()` afterward for conservative cross-dataset
   *   reconciliation and relation-member rewrites.
   */
  generateDirectChanges(patch: Osm) {
    this.inheritPatchIntegrity(patch);

    // Reset the current node ID to the highest node ID in the base or patch.
    const maximums = [maximumId(this.osm.nodes.ids), maximumId(patch.nodes.ids)].filter(
      (id): id is number => id !== null,
    );
    this.currentNodeId = maximums.length === 0 ? EMPTY_ID : Math.max(...maximums);

    // First, create or modify all ways in the patch
    for (let patchIndex = 0; patchIndex < patch.ways.size; patchIndex++) {
      const way = patch.ways.getByIndex(patchIndex);

      // Check for ways with exact IDs
      if (this.osm.ways.ids.has(way.id)) {
        const existingWay = this.osm.ways.getById(way.id);
        if (existingWay && !entityPropertiesEqual(existingWay, way)) {
          // Replace the existing entity with the patch entity
          this.modify("way", way.id, (_existingWay) => removeDuplicateAdjacentWayRefs(way));
        }
      } else {
        // Create the way
        this.create(removeDuplicateAdjacentWayRefs(way), patch.id);
      }
    }

    // Second, create or modify all nodes in the patch. This is after ways to properly de-duplicate nodes.
    for (const node of patch.nodes) {
      if (this.osm.nodes.ids.has(node.id)) {
        const existingNode = this.osm.nodes.getById(node.id);
        if (existingNode && !entityPropertiesEqual(existingNode, node)) {
          // Replace the existing entity with the patch entity
          this.modify("node", node.id, (_existingNode) => node);
        }
      } else {
        this.create(node, patch.id);
      }
    }

    for (const relation of patch.relations) {
      if (this.osm.relations.ids.has(relation.id)) {
        const existingRelation = this.osm.relations.getById(relation.id);
        if (existingRelation && !entityPropertiesEqual(existingRelation, relation)) {
          // Replace the existing entity with the patch entity
          this.modify("relation", relation.id, (_existingRelation) => relation);
        }
      } else {
        this.create(relation, patch.id);
      }
    }
  }
}

class IdPairs {
  #idPairs = new Map<number, number | Set<number>>();

  add(firstId: number, secondId: number) {
    const lowerId = Math.min(firstId, secondId);
    const higherId = Math.max(firstId, secondId);
    const partners = this.#idPairs.get(lowerId);
    if (partners === undefined) this.#idPairs.set(lowerId, higherId);
    else if (typeof partners === "number") {
      if (partners !== higherId) this.#idPairs.set(lowerId, new Set([partners, higherId]));
    } else partners.add(higherId);
  }

  has(firstId: number, secondId: number) {
    const lowerId = Math.min(firstId, secondId);
    const higherId = Math.max(firstId, secondId);
    const partners = this.#idPairs.get(lowerId);
    return typeof partners === "number"
      ? partners === higherId
      : (partners?.has(higherId) ?? false);
  }

  clear() {
    this.#idPairs.clear();
  }
}
