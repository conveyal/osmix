/**
 * OSM changeset tracking and manipulation.
 *
 * The OsmChangeset class tracks creates, modifies, and deletes for nodes, ways,
 * and relations. It provides methods for deduplication, intersection creation,
 * and direct merging of OSM datasets.
 *
 * @module
 */

import type { IdOrIndex, Nodes, Osm, Ways } from "@osmix/core";
import { toMicroDegrees } from "@osmix/geo/coordinates";
import type { OsmEntity, OsmEntityType, OsmEntityTypeMap, OsmNode, OsmWay } from "@osmix/types";
import { entityPropertiesEqual, getEntityType } from "@osmix/types/utils";
import { dequal } from "dequal"; // dequal/lite does not work with `TypedArray`s

import { inheritedRoutingIntegrityIssueKeys, routingIntegrityIssueKeys } from "./integrity.ts";
import type { OsmChange, OsmChanges, OsmChangesetStats, OsmEntityRef } from "./types.ts";
import {
  cleanCoords,
  entityHasTagValue,
  isWayIntersectionCandidate,
  nearestNodeOnWay,
  removeDuplicateAdjacentRelationMembers,
  removeDuplicateAdjacentWayRefs,
  waysIntersect,
  waysShouldConnect,
} from "./utils.ts";

type ReplacementMap = Map<number, number>;
type IdIndex = Nodes["ids"];

const EMPTY_ID = -1;
const DESCRIPTIVE_WAY_TAGS = new Set([
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
const DESCRIPTIVE_WAY_TAG_PREFIXES = [
  "alt_name:",
  "name:",
  "note:",
  "official_name:",
  "old_name:",
  "operator:",
  "source:",
] as const;
const GRADE_AND_ACCESS_TAGS = [
  "access",
  "barrier",
  "bicycle",
  "foot",
  "horse",
  "motor_vehicle",
  "motorcar",
  "vehicle",
] as const;
const GRADE_TAG_DEFAULTS = {
  bridge: "no",
  covered: "no",
  layer: "0",
  level: "",
  tunnel: "no",
} as const;
const NODE_ROUTING_CRITICAL_TAGS = [
  "access",
  "barrier",
  "bicycle",
  "foot",
  "ford",
  "highway",
  "horse",
  "motor_vehicle",
  "motorcar",
  "vehicle",
] as const;

function sameOsmCoordinate(a: OsmNode, b: OsmNode) {
  return (
    toMicroDegrees(a.lon) === toMicroDegrees(b.lon) &&
    toMicroDegrees(a.lat) === toMicroDegrees(b.lat)
  );
}

function hasAnyTagConflict(a: OsmEntity["tags"], b: OsmEntity["tags"]) {
  if (!a || !b) return false;
  return Object.entries(a).some(([key, value]) => b[key] != null && b[key] !== value);
}

function isDescriptiveWayTag(key: string) {
  return (
    DESCRIPTIVE_WAY_TAGS.has(key) ||
    DESCRIPTIVE_WAY_TAG_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function routingSemanticTagsEqual(a: OsmEntity["tags"], b: OsmEntity["tags"]) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].every((key) => isDescriptiveWayTag(key) || a?.[key] === b?.[key]);
}

function hasConflictingGradeOrAccessTags(a: OsmEntity["tags"], b: OsmEntity["tags"]) {
  if (GRADE_AND_ACCESS_TAGS.some((key) => String(a?.[key] ?? "") !== String(b?.[key] ?? ""))) {
    return true;
  }
  return Object.entries(GRADE_TAG_DEFAULTS).some(
    ([key, defaultValue]) => String(a?.[key] ?? defaultValue) !== String(b?.[key] ?? defaultValue),
  );
}

function withNonConflictingTags<T extends OsmEntity>(base: T, patch: T): T {
  if (!patch.tags) return base;
  const tags = { ...base.tags };
  let changed = false;
  for (const [key, value] of Object.entries(patch.tags)) {
    if (tags[key] != null) continue;
    tags[key] = value;
    changed = true;
  }
  return changed ? { ...base, tags } : base;
}

function withNonConflictingDescriptiveTags<T extends OsmEntity>(base: T, patch: T): T {
  if (!patch.tags) return base;
  const tags = { ...base.tags };
  let changed = false;
  for (const [key, value] of Object.entries(patch.tags)) {
    if (!isDescriptiveWayTag(key) || tags[key] != null) continue;
    tags[key] = value;
    changed = true;
  }
  return changed ? { ...base, tags } : base;
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

/**
 * Tracks changes to an OSM dataset and provides utilities for deduplication and merging.
 *
 * The changeset maintains a record of creates, modifies, and deletes for nodes, ways,
 * and relations. It is optimized to minimize full entity retrieval until necessary.
 */
export class OsmChangeset {
  nodeChanges: Record<number, OsmChange<OsmEntityTypeMap["node"]>> = {};
  wayChanges: Record<number, OsmChange<OsmEntityTypeMap["way"]>> = {};
  relationChanges: Record<number, OsmChange<OsmEntityTypeMap["relation"]>> = {};

  osm: Osm;
  /** @internal Integrity issues inherited from merge inputs rather than introduced by changes. */
  routingIntegrityBaselineKeys: Set<string>;

  // Next node ID tracker for generating new IDs during intersection creation
  currentNodeId: number;

  deduplicatedNodes = 0;
  deduplicatedNodesReplaced = 0;
  deduplicatedWays = 0;
  intersectionPointsFound = 0;
  intersectionNodesCreated = 0;

  static fromJson(base: Osm, json: OsmChanges) {
    const changeset = new OsmChangeset(base);
    changeset.nodeChanges = json.nodes;
    changeset.wayChanges = json.ways;
    changeset.relationChanges = json.relations;
    return changeset;
  }

  constructor(base: Osm) {
    this.osm = base;
    this.currentNodeId = maximumId(base.nodes.ids) ?? EMPTY_ID;
    this.routingIntegrityBaselineKeys = routingIntegrityIssueKeys(base);
  }

  get stats(): OsmChangesetStats {
    const nodeChanges = Object.values(this.nodeChanges).length;
    const wayChanges = Object.values(this.wayChanges).length;
    const relationChanges = Object.values(this.relationChanges).length;
    return {
      osmId: this.osm.id,
      totalChanges: nodeChanges + wayChanges + relationChanges,
      nodeChanges,
      wayChanges,
      relationChanges,
      deduplicatedNodes: this.deduplicatedNodes,
      deduplicatedNodesReplaced: this.deduplicatedNodesReplaced,
      deduplicatedWays: this.deduplicatedWays,
      intersectionPointsFound: this.intersectionPointsFound,
      intersectionNodesCreated: this.intersectionNodesCreated,
    };
  }

  changes<T extends OsmEntityType>(type: T): Record<number, OsmChange<OsmEntityTypeMap[T]>> {
    switch (type) {
      case "node":
        return this.nodeChanges as Record<number, OsmChange<OsmEntityTypeMap[T]>>;
      case "way":
        return this.wayChanges as Record<number, OsmChange<OsmEntityTypeMap[T]>>;
      case "relation":
        return this.relationChanges as Record<number, OsmChange<OsmEntityTypeMap[T]>>;
    }
  }

  nextNodeId() {
    if (!Number.isSafeInteger(this.currentNodeId)) {
      throw Error("Cannot allocate node ID outside the safe integer range");
    }
    const nextId = this.currentNodeId + 1;
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
    this.changes(getEntityType(entity))[entity.id] = {
      changeType: "create",
      entity,
      osmId,
      refs, // Refs can come from other datasets, useful for tracking provenance
    };
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
    if (this.changes(type)[id]?.changeType === "delete") {
      throw Error(`Cannot modify ${type} ${id}: entity is scheduled for deletion`);
    }

    const changes = this.changes(type);
    const change = changes[id];
    const changeEntity = change ? (change.entity as OsmEntityTypeMap[T]) : undefined;
    const existingEntity = changeEntity ?? this.getEntity(type, id);
    if (existingEntity == null) throw Error("Entity not found");

    // For augmented diffs: capture the original entity from the base dataset
    // if this is the first modification (not an update to an existing change).
    // If we already have a change, preserve the original oldEntity.
    const oldEntity = change?.oldEntity ?? (changeEntity ? undefined : existingEntity);

    changes[id] = {
      changeType: change?.changeType ?? "modify",
      entity: modify(existingEntity),
      osmId: this.osm.id, // If we're modifying an entity, it must exist in the base OSM
      oldEntity,
    };
  }

  getEntity<T extends OsmEntityType>(type: T, id: number): OsmEntityTypeMap[T] | undefined {
    if (type === "node") return this.osm.nodes.get({ id }) as OsmEntityTypeMap[T];
    if (type === "way") return this.osm.ways.get({ id }) as OsmEntityTypeMap[T];
    if (type === "relation") return this.osm.relations.get({ id }) as OsmEntityTypeMap[T];
  }

  /**
   * Schedule an entity for deletion.
   *
   * For augmented diffs, the `oldEntity` field is set to the entity being deleted,
   * capturing its state before removal.
   */
  delete(entity: OsmEntity, refs?: OsmEntityRef[]) {
    this.changes(getEntityType(entity))[entity.id] = {
      changeType: "delete",
      entity,
      refs,
      osmId: this.osm.id,
      oldEntity: entity, // For augmented diffs: capture the entity being deleted
    };
  }

  private currentWays() {
    const ways = new Map<number, OsmWay>();
    for (const way of this.osm.ways) {
      const current = this.getCurrentWay(way);
      if (current) ways.set(current.id, current);
    }
    for (const change of Object.values(this.wayChanges)) {
      if (change.changeType === "delete") ways.delete(change.entity.id);
      else ways.set(change.entity.id, change.entity);
    }
    return ways.values();
  }

  private currentRelations() {
    const relations = new Map<number, OsmEntityTypeMap["relation"]>();
    for (const relation of this.osm.relations) {
      const change = this.relationChanges[relation.id];
      if (change?.changeType === "delete") continue;
      relations.set(relation.id, change?.entity ?? relation);
    }
    for (const change of Object.values(this.relationChanges)) {
      if (change.changeType === "delete") relations.delete(change.entity.id);
      else relations.set(change.entity.id, change.entity);
    }
    return relations.values();
  }

  private nodeContextsCompatible(patchNode: OsmNode, baseNode: OsmNode) {
    if (hasAnyTagConflict(patchNode.tags, baseNode.tags)) return false;
    if (hasConflictingGradeOrAccessTags(patchNode.tags, baseNode.tags)) return false;

    const patchWays: OsmWay[] = [];
    const baseWays: OsmWay[] = [];
    for (const way of this.currentWays()) {
      if (way.refs.includes(patchNode.id)) patchWays.push(way);
      if (way.refs.includes(baseNode.id)) baseWays.push(way);
    }
    if (patchWays.length === 0 || baseWays.length === 0) return true;

    return patchWays.every((patchWay) =>
      baseWays.every(
        (baseWay) =>
          !hasConflictingGradeOrAccessTags(patchWay.tags, baseWay.tags) &&
          (patchWay.tags?.["highway"] == null) === (baseWay.tags?.["highway"] == null),
      ),
    );
  }

  private removeUnsafeNodeReplacements(replacementMap: ReplacementMap) {
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

  private reconcileNodeTags(patchNode: OsmNode, baseNodeId: number) {
    const baseNode = this.getCurrentNode(baseNodeId);
    if (!baseNode) return;
    const mergedNode = withNonConflictingTags(baseNode, patchNode);
    if (mergedNode !== baseNode) this.modify("node", baseNodeId, () => mergedNode);
  }

  private deleteReconciledNode(node: OsmNode, survivorId: number) {
    const pendingChange = this.nodeChanges[node.id];
    if (pendingChange?.changeType === "create") {
      delete this.nodeChanges[node.id];
    } else {
      const storedNode = this.osm.nodes.getById(node.id);
      if (!storedNode) return;
      this.delete(storedNode, [{ type: "node", id: survivorId, osmId: this.osm.id }]);
    }
    this.deduplicatedNodes++;
  }

  /**
   * Reconcile incoming nodes with unambiguous base nodes at the exact OSM coordinate.
   * Cross-dataset reconciliation always preserves the base ID. Same-dataset diagnostic
   * scans use the highest compatible ID as a deterministic candidate survivor.
   */
  deduplicateNodes(nodes: Nodes) {
    const patchNodes = [...nodes];
    const sameDataset = nodes === this.osm.nodes;
    const replacementMap: ReplacementMap = new Map();

    for (const patchNode of patchNodes) {
      if (this.nodeChanges[patchNode.id]?.changeType === "delete") continue;
      if (!sameDataset && this.nodeChanges[patchNode.id]?.changeType !== "create") continue;
      const currentPatchNode = this.getCurrentNode(patchNode.id);
      if (!currentPatchNode) continue;

      // Keep the indexed radius query as the scalability gate, then require exact
      // equality at OSM's seven-decimal coordinate precision.
      const candidateNodes = this.osm.nodes
        .findIndexesWithinRadius(patchNode.lon, patchNode.lat, 0.001)
        .map((index) => this.osm.nodes.getByIndex(index))
        .map((baseNode) => this.getCurrentNode(baseNode.id) ?? baseNode)
        .filter(
          (baseNode) =>
            baseNode.id !== patchNode.id &&
            (!sameDataset || baseNode.id > patchNode.id) &&
            this.nodeChanges[baseNode.id]?.changeType !== "delete" &&
            sameOsmCoordinate(currentPatchNode, baseNode) &&
            this.nodeContextsCompatible(currentPatchNode, baseNode),
        );

      if (candidateNodes.length === 0 || (!sameDataset && candidateNodes.length !== 1)) continue;
      const baseNode = sameDataset
        ? candidateNodes.toSorted((a, b) => b.id - a.id)[0]
        : candidateNodes[0];
      replacementMap.set(patchNode.id, baseNode!.id);
    }

    this.removeUnsafeNodeReplacements(replacementMap);
    this.applyNodeReplacementsToWays(replacementMap);
    this.applyNodeReplacementsToRelations(replacementMap);

    for (const [patchNodeId, baseNodeId] of replacementMap) {
      const patchNode =
        this.getCurrentNode(patchNodeId) ?? patchNodes.find((node) => node.id === patchNodeId);
      if (!patchNode) continue;
      this.reconcileNodeTags(patchNode, baseNodeId);
      this.deleteReconciledNode(patchNode, baseNodeId);
    }
    return replacementMap;
  }

  /**
   * Apply node replacements to all ways in the OSM dataset.
   * Returns the total number of node references replaced.
   */
  private applyNodeReplacementsToWays(replacementMap: Map<number, number>): number {
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

  private replaceRestrictionViaNode(fromId: number, toId: number) {
    for (const relation of this.currentRelations()) {
      if (
        relation.tags?.["type"] !== "restriction" ||
        !relation.members.some(
          (member) => member.type === "node" && member.role === "via" && member.ref === fromId,
        )
      ) {
        continue;
      }
      this.modify("relation", relation.id, (relation) =>
        removeDuplicateAdjacentRelationMembers({
          ...relation,
          members: relation.members.map((member) =>
            member.type === "node" && member.role === "via" && member.ref === fromId
              ? { ...member, ref: toId }
              : member,
          ),
        }),
      );
    }
  }

  private chooseIntersectionNode(
    wayNode: OsmNode,
    intersectingWayNode: OsmNode,
    wayIsPatch: boolean,
    intersectingWayIsPatch: boolean,
  ) {
    if (hasAnyTagConflict(wayNode.tags, intersectingWayNode.tags)) return null;

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
    return { keepWayNode, replaced, survivor };
  }

  private mergeNodeTags(survivor: OsmNode, replaced: OsmNode) {
    const merged = withNonConflictingTags(survivor, replaced);
    if (merged !== survivor) this.modify("node", survivor.id, () => merged);
    return merged;
  }

  private markNodeAsCrossing(nodeId: number) {
    const node = this.getCurrentNode(nodeId);
    if (!node || entityHasTagValue(node, "crossing", "yes")) return;
    this.modify("node", node.id, (node) => ({
      ...node,
      tags: { ...node.tags, crossing: "yes" },
    }));
  }

  /**
   * De-duplicate the ways within this OSM changeset.
   */
  *deduplicateWaysGenerator(ways: Ways, replacementMap: ReplacementMap = new Map()) {
    const dedupedIdPairs = new IdPairs();
    const patchWays = [...ways];
    const sameDataset = ways === this.osm.ways;
    for (const way of patchWays) {
      if (this.wayChanges[way.id]?.changeType === "delete") continue;
      yield this.deduplicateWayAgainstBase(way, sameDataset, dedupedIdPairs, replacementMap);
    }
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
      delete this.wayChanges[way.id];
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
  ) {
    if (!this.osm.ways.ids.has(patchWay.id) && this.wayChanges[patchWay.id] == null) return 0;
    if (!sameDataset && this.wayChanges[patchWay.id]?.changeType !== "create") return 0;
    const currentPatchWay =
      this.getCurrentWay(patchWay) ?? this.wayChanges[patchWay.id]?.entity ?? patchWay;
    const wayCoords = this.getWayCoordinates(currentPatchWay);
    if (!wayCoords || wayCoords.length < 2) return 0;

    const closeWayIndexes = this.osm.ways.intersects(wayBbox(wayCoords));
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
   * @param ways - The ways to process for intersections
   * @yields Statistics object with `intersectionsFound` and `intersectionsCreated` counts
   */
  *createIntersectionsForWaysGenerator(ways: Ways) {
    const wayIdPairs = new IdPairs();
    const patchWayIds = new Set([...ways].map((way) => way.id));
    for (const way of ways) {
      if (!this.osm.ways.ids.has(way.id)) continue;
      yield this.createIntersectionsForWayInternal({ id: way.id }, wayIdPairs, patchWayIds);
    }
  }

  createIntersectionsForWays(ways: Ways) {
    for (const _ of this.createIntersectionsForWaysGenerator(ways));
  }

  private getCurrentWay(way: OsmWay): OsmWay | null {
    const change = this.wayChanges[way.id];
    if (change?.changeType === "delete") return null;
    return change?.entity ?? way;
  }

  private getCurrentNode(id: number): OsmNode | null {
    const change = this.nodeChanges[id];
    if (change?.changeType === "delete") return null;
    return change?.entity ?? this.osm.nodes.getById(id);
  }

  /**
   * Resolve way coordinates from the base dataset plus pending node changes.
   * Returns null when any ref is genuinely unavailable instead of substituting geometry.
   */
  private getWayCoordinates(way: OsmWay): [number, number][] | null {
    const coordinates: [number, number][] = [];
    for (const ref of way.refs) {
      const node = this.getCurrentNode(ref);
      if (!node) return null;
      coordinates.push([node.lon, node.lat]);
    }
    return coordinates;
  }

  /**
   * Create intersections for a single way.
   * - Finds other ways that intersect the given way's bounding box.
   * - Checks if they should connect (e.g. both are highways/paths, not tunnels/bridges).
   * - Calculates intersection points.
   * - Inserts existing nodes or creates new intersection nodes at the crossing points.
   */
  createIntersectionsForWay(wayIdOrIndex: IdOrIndex, wayIdPairs: IdPairs) {
    return this.createIntersectionsForWayInternal(wayIdOrIndex, wayIdPairs, null);
  }

  private createIntersectionsForWayInternal(
    wayIdOrIndex: IdOrIndex,
    wayIdPairs: IdPairs,
    patchWayIds: ReadonlySet<number> | null,
  ) {
    let intersectionsFound = 0;
    let intersectionsCreated = 0;

    // Get the actual way from the OSM data (which may have been modified by deduplication)
    const [wayIndex] = this.osm.ways.ids.idOrIndex(wayIdOrIndex);
    const baseWay = this.osm.ways.getByIndex(wayIndex);
    const initialWay = this.getCurrentWay(baseWay);
    if (!initialWay) return;
    if (!isWayIntersectionCandidate(initialWay)) return;

    const initialWayCoordinates = this.getWayCoordinates(initialWay);
    if (!initialWayCoordinates || initialWayCoordinates.length < 2) return;

    // Check for intersecting ways. Since the way exists in the base OSM, there will always be at least one way.
    const bbox = this.osm.ways.getEntityBbox({ index: wayIndex });
    const intersectingWayIndexes = this.osm.ways.intersects(bbox);
    if (intersectingWayIndexes.length <= 1) return; // No candidates

    for (const intersectingWayIndex of intersectingWayIndexes) {
      const intersectingWayId = this.osm.ways.ids.at(intersectingWayIndex);

      // Skip self and null ways
      if (intersectingWayId == null || intersectingWayId === initialWay.id) continue;
      if (wayIdPairs.has(initialWay.id, intersectingWayId)) continue;
      wayIdPairs.add(initialWay.id, intersectingWayId);

      // Skip ways that aren't applicable for connecting
      const way = this.getCurrentWay(baseWay);
      const intersectingWay = this.getCurrentWay(this.osm.ways.getByIndex(intersectingWayIndex));
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
      const coordinates = cleanCoords(wayCoordinates);
      const intersectingWayCoords = cleanCoords(intersectingWayCoordinates);

      // Skip ways that are geometrically equal
      if (dequal(coordinates, intersectingWayCoords)) continue;

      const intersectingPoints = waysIntersect(coordinates, intersectingWayCoords);
      for (const pt of intersectingPoints) {
        const currentWay = this.getCurrentWay(baseWay);
        const currentIntersectingWay = this.getCurrentWay(
          this.osm.ways.getByIndex(intersectingWayIndex),
        );
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
          this.markNodeAsCrossing(wayNodeId);
          continue;
        }

        let endpointResolution: ReturnType<OsmChangeset["chooseIntersectionNode"]> | undefined;
        if (wayNodeId != null && intersectingWayNodeId != null) {
          const wayNode = this.getCurrentNode(wayNodeId);
          const intersectingWayNode = this.getCurrentNode(intersectingWayNodeId);
          if (!wayNode || !intersectingWayNode) continue;
          endpointResolution = this.chooseIntersectionNode(
            wayNode,
            intersectingWayNode,
            patchWayIds?.has(currentWay.id) ?? false,
            patchWayIds?.has(currentIntersectingWay.id) ?? false,
          );
          if (!endpointResolution) continue;
        }

        intersectionsFound++;

        if (endpointResolution) {
          const survivor = this.mergeNodeTags(
            endpointResolution.survivor,
            endpointResolution.replaced,
          );
          if (endpointResolution.keepWayNode) {
            this.modify("way", currentIntersectingWay.id, (way) => ({
              ...way,
              refs: way.refs.map((ref) =>
                ref === endpointResolution!.replaced.id ? survivor.id : ref,
              ),
            }));
          } else {
            this.modify("way", currentWay.id, (way) => ({
              ...way,
              refs: way.refs.map((ref) =>
                ref === endpointResolution!.replaced.id ? survivor.id : ref,
              ),
            }));
          }
          this.replaceRestrictionViaNode(endpointResolution.replaced.id, survivor.id);
          this.markNodeAsCrossing(survivor.id);
        } else if (wayNodeId != null) {
          const wayNode = this.getCurrentNode(wayNodeId);
          if (wayNode == null) throw Error(`Way node ${String(wayNodeId)} not found`);
          this.spliceNodeIntoWay(currentIntersectingWay, wayNode);
          this.markNodeAsCrossing(wayNode.id);
        } else if (intersectingWayNodeId != null) {
          const intersectingWayNode = this.getCurrentNode(intersectingWayNodeId);
          if (intersectingWayNode == null)
            throw Error(`Intersecting way node ${String(intersectingWayNodeId)} not found`);

          this.spliceNodeIntoWay(currentWay, intersectingWayNode);
          this.markNodeAsCrossing(intersectingWayNode.id);
        } else {
          intersectionsCreated++;

          const newIntersectionNode: OsmNode = {
            id: this.nextNodeId(),
            lon: pt[0],
            lat: pt[1],
            tags: {
              crossing: "yes",
            },
          };
          this.create(newIntersectionNode, this.osm.id, [
            { type: "way", id: currentWay.id, osmId: this.osm.id },
            { type: "way", id: currentIntersectingWay.id, osmId: this.osm.id },
          ]);

          // Splice into the existing ways
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
    for (const key of inheritedRoutingIntegrityIssueKeys(this.osm, patch)) {
      this.routingIntegrityBaselineKeys.add(key);
    }

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
  #idPairs = new Set<string>();

  #makeIdsKey(wayIds: number[]) {
    return wayIds.toSorted((a, b) => a - b).join(",");
  }

  add(...wayIds: number[]) {
    this.#idPairs.add(this.#makeIdsKey(wayIds));
  }

  has(...wayIds: number[]) {
    return this.#idPairs.has(this.#makeIdsKey(wayIds));
  }

  clear() {
    this.#idPairs.clear();
  }
}
