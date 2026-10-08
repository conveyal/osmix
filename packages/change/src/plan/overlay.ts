/**
 * The planned state: a base `Osm` plus pending change records, read as one dataset without
 * building it. Every merge phase reads through this overlay, so a later phase sees what an
 * earlier one decided and nothing is rebuilt until the plan is applied.
 *
 * Reads resolve a record first and fall back to the base. Spatial queries combine the base's
 * packed indexes, for geometry no record touched, with a hash grid of pending geometry that is
 * kept current as records change.
 */
import type { Osm } from "@osmix/core";
import { haversineDistance } from "@osmix/geo/haversine-distance";
import type {
  GeoBbox2D,
  OsmEntity,
  OsmEntityType,
  OsmEntityTypeMap,
  OsmNode,
  OsmRelation,
  OsmWay,
} from "@osmix/types";
import { getEntityType } from "@osmix/types/utils";
import { dequal } from "dequal"; // dequal/lite does not work with `TypedArray`s

import { ChangeRecordTable } from "../change-records.ts";
import type { OsmChange, OsmEntityRef } from "../types.ts";
import { cleanCoords } from "../utils.ts";
import type { DatasetReader, EntityReader } from "../views.ts";
import { patchLayers } from "./patch-layer.ts";

/** An earlier state of an overlay, read by ID, with the IDs that may differ from now. */
export interface EarlierState {
  getNode(id: number): OsmNode | null;
  getWay(id: number): OsmWay | null;
  getRelation(id: number): OsmRelation | null;
  /** Entities that may read differently now than in this state. */
  changedIds(type: OsmEntityType): Iterable<number>;
}
import { GridIndex } from "./grid-index.ts";

/**
 * Pending records by ID. A record a plan dropped stays as an `undefined` tombstone, so undoing
 * the drop puts it back in its place and created entities keep their order.
 */
export type ChangeRecords<T extends OsmEntityType> = ChangeRecordTable<OsmEntityTypeMap[T]>;

interface WayCoordinateCacheEntry {
  cleaned?: [number, number][];
  coordinates: [number, number][] | null;
  wayRevision: number;
}

/** One record write: what the record was before, and whether its key existed. */
interface JournalEntry {
  type: OsmEntityType;
  id: number;
  previous: OsmChange | undefined;
  existed: boolean;
}

/** A position in the journal to undo back to. */
export type OverlayMark = number;

/** Pending geometry, built on the first spatial query and maintained on every change after. */
interface PendingGeometry {
  nodes: GridIndex;
  ways: GridIndex;
  /** Ways whose base geometry no longer applies: changed records, or a vertex moved. */
  trackedWays: Set<number>;
}

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * Coordinates of ways nothing has changed, read from packed columns, kept in a bounded
 * direct-mapped cache: a phase reads the same nearby ways again and again, but caching every way
 * it touched held the whole plan's geometry as arrays (T35).
 */
const PACKED_COORDINATES_SLOTS = 1 << 15;
const packedSlot = (id: number) =>
  (Math.imul(id | 0, 0x9e3779b1) >>> 17) & (PACKED_COORDINATES_SLOTS - 1);
const EMPTY_IDS: ReadonlySet<number> = new Set();

export class PlanOverlay {
  nodeChanges: ChangeRecords<"node"> = new ChangeRecordTable();
  wayChanges: ChangeRecords<"way"> = new ChangeRecordTable();
  relationChanges: ChangeRecords<"relation"> = new ChangeRecordTable();

  /** Revisions keep geometry caches correct while phases rewrite ways in place. */
  private readonly wayGeometryRevisions = new Map<number, number>();
  private pendingWayIdsByNode: Map<number, Set<number>> | undefined;
  private readonly pendingWayRefs = new Map<number, readonly number[]>();
  /** Coordinates of ways with a record, or at a changed node. */
  private readonly wayCoordinateCache = new Map<number, WayCoordinateCacheEntry>();
  private packedCoordinateIds = new Float64Array(PACKED_COORDINATES_SLOTS).fill(Number.NaN);
  /** Whether any packed coordinates are cached, so a moved node must invalidate them. */
  private packedCached = false;
  private packedCoordinates: (WayCoordinateCacheEntry | undefined)[] = Array.from({
    length: PACKED_COORDINATES_SLOTS,
  });
  private geometry: PendingGeometry | undefined;
  /** Record writes since the first mark, to undo back to a mark; null before any mark. */
  private journal: JournalEntry[] | null = null;
  /** The patch, when its untouched entities are read from it rather than stored (T35). */
  private patch: Osm | undefined;
  /**
   * Layer ways by the nodes they reference that the patch lacks (base nodes): the patch's way
   * index places a way by its own nodes only, so it cannot find these.
   */
  private layerWaysByForeignNode = new Map<number, number[]>();

  readonly base: Osm;

  constructor(base: Osm) {
    this.base = base;
  }

  /**
   * Read `patch`'s entities the base does not have from the patch itself, as create records,
   * instead of storing one record each (T35). A phase that changes one writes a record of its
   * own over it; dropping one writes a dropped record. Call before any record is written.
   * Spatial queries read the patch's all-node and way indexes, built here if it lacks them.
   */
  usePatchLayer(patch: Osm) {
    if (this.nodeChanges.size + this.wayChanges.size + this.relationChanges.size > 0) {
      throw Error("A patch layer must come before any record");
    }
    patch.nodes.buildSpatialIndex("all");
    patch.ways.buildSpatialIndex();
    const layers = patchLayers(this.base, patch);
    this.patch = patch;
    for (let index = 0; index < patch.ways.size; index++) {
      const way = patch.ways.getByIndex(index);
      if (this.base.ways.ids.has(way.id)) continue;
      for (const ref of new Set(way.refs)) {
        if (patch.nodes.ids.has(ref)) continue;
        const ways = this.layerWaysByForeignNode.get(ref) ?? [];
        ways.push(way.id);
        this.layerWaysByForeignNode.set(ref, ways);
      }
    }
    this.nodeChanges = new ChangeRecordTable(layers.node);
    this.wayChanges = new ChangeRecordTable(layers.way);
    this.relationChanges = new ChangeRecordTable(layers.relation);
  }

  changes<T extends OsmEntityType>(type: T): ChangeRecords<T> {
    switch (type) {
      case "node":
        return this.nodeChanges as ChangeRecords<T>;
      case "way":
        return this.wayChanges as ChangeRecords<T>;
      case "relation":
        return this.relationChanges as ChangeRecords<T>;
    }
  }

  /**
   * Mark the current state. Writes from here on are journaled, so `undoTo` can return here; a
   * mark stays valid through any number of undos to it.
   */
  mark(): OverlayMark {
    this.journal ??= [];
    return this.journal.length;
  }

  /**
   * Return to `mark` by undoing every write since, newest first. Derived state follows each
   * undone write as it followed the write itself, so caches for untouched ways stay valid.
   */
  undoTo(mark: OverlayMark) {
    const journal = this.journal;
    if (!journal || mark > journal.length) throw Error(`No overlay mark ${mark} to undo to`);
    while (journal.length > mark) {
      const { type, id, previous, existed } = journal.pop()!;
      const records = this.changes(type) as ChangeRecordTable;
      const before = type === "node" ? this.getNode(id) : null;
      if (existed) records.set(id, previous);
      else records.delete(id);
      if (type === "node") this.nodeChanged(id, before);
      else if (type === "way") this.invalidateWayGeometry(id);
    }
  }

  /**
   * The state at `mark`, read by ID while later writes continue: an entity written since reads
   * as it was then. Valid until an undo to `mark` or earlier.
   */
  stateAt(mark: OverlayMark): EarlierState {
    const journal = this.journal;
    if (!journal) throw Error("No overlay mark to read");
    const first = {
      node: new Map<number, JournalEntry>(),
      way: new Map<number, JournalEntry>(),
      relation: new Map<number, JournalEntry>(),
    };
    let cursor = mark;
    const sync = () => {
      for (; cursor < journal.length; cursor++) {
        const entry = journal[cursor]!;
        const seen = first[entry.type];
        if (!seen.has(entry.id)) seen.set(entry.id, entry);
      }
    };
    const read = <T extends OsmEntity>(
      type: OsmEntityType,
      id: number,
      current: (id: number) => T | null,
      base: (id: number) => T | null,
    ): T | null => {
      sync();
      const entry = first[type].get(id);
      if (!entry) return current(id);
      // No record of its own then: as the layer has it, else as the base has it.
      if (!entry.existed) {
        const layered = this.changes(type).layerRecord(id);
        if (layered) return layered.entity as T;
        return base(id);
      }
      const change = entry.previous;
      if (!change) return base(id);
      return change.changeType === "delete" ? null : (change.entity as T);
    };
    return {
      getNode: (id) =>
        read(
          "node",
          id,
          (key) => this.getNode(key),
          (key) => this.base.nodes.getById(key),
        ),
      getWay: (id) =>
        read(
          "way",
          id,
          (key) => this.getWay(key),
          (key) => this.base.ways.getById(key),
        ),
      getRelation: (id) =>
        read(
          "relation",
          id,
          (key) => this.getRelation(key),
          (key) => this.base.relations.getById(key),
        ),
      changedIds: (type) => {
        sync();
        return first[type].keys();
      },
    };
  }

  /** Write one record, journaling what it replaces; `undefined` leaves a tombstone. */
  private write(type: OsmEntityType, id: number, next: OsmChange | undefined) {
    const records = this.changes(type) as ChangeRecordTable;
    // The journal records a key's own record; a layer entity without one reads from the layer.
    this.journal?.push({
      type,
      id,
      previous: records.get(id),
      existed: records.hasOverride(id),
    });
    // Writes before the first mark are the direct phase's, which came first in record order.
    records.set(id, next, { direct: this.journal === null });
  }

  /** The entity as stored in the base, ignoring records. */
  baseEntity<T extends OsmEntityType>(type: T, id: number): OsmEntityTypeMap[T] | undefined {
    if (type === "node") return this.base.nodes.get({ id }) as OsmEntityTypeMap[T];
    if (type === "way") return this.base.ways.get({ id }) as OsmEntityTypeMap[T];
    return this.base.relations.get({ id }) as OsmEntityTypeMap[T];
  }

  getNode(id: number): OsmNode | null {
    const change = this.nodeChanges.get(id);
    if (change?.changeType === "delete") return null;
    return change?.entity ?? this.base.nodes.getById(id);
  }

  /** Whether node `id` is in the planned state, without decoding it. */
  hasNode(id: number): boolean {
    if (this.nodeChanges.hasOverride(id)) {
      const change = this.nodeChanges.get(id);
      return change ? change.changeType !== "delete" : this.base.nodes.ids.has(id);
    }
    return this.nodeChanges.layerRecord(id) !== undefined || this.base.nodes.ids.has(id);
  }

  getWay(id: number): OsmWay | null {
    const change = this.wayChanges.get(id);
    if (change?.changeType === "delete") return null;
    return change?.entity ?? this.base.ways.getById(id);
  }

  getRelation(id: number): OsmRelation | null {
    const change = this.relationChanges.get(id);
    if (change?.changeType === "delete") return null;
    return change?.entity ?? this.base.relations.getById(id);
  }

  /** The current version of an already decoded way; skips a second base lookup. */
  currentWay(way: OsmWay): OsmWay | null {
    const change = this.wayChanges.get(way.id);
    if (change?.changeType === "delete") return null;
    return change?.entity ?? way;
  }

  /**
   * Record a new entity. `unreferenced` marks a node no current way references yet (a fresh
   * ID), so cached way geometry stays valid until a way is changed to use it.
   */
  create(
    entity: OsmEntity,
    osmId: string,
    refs?: OsmEntityRef[],
    options: { unreferenced?: boolean } = {},
  ) {
    const type = getEntityType(entity);
    const before = type === "node" && !options.unreferenced ? this.getNode(entity.id) : null;
    this.write(type, entity.id, {
      changeType: "create",
      entity,
      osmId,
      refs, // Refs can come from other datasets, useful for tracking provenance
    });
    if (type === "node" && options.unreferenced) {
      const node = entity as OsmNode;
      this.geometry?.nodes.set(node.id, [node.lon, node.lat, node.lon, node.lat]);
    } else if (type === "node") this.nodeChanged(entity.id, before);
    if (type === "way") this.invalidateWayGeometry(entity.id);
  }

  /**
   * Add or update a change for an entity that exists in the base or has a pending create. A
   * first modification keeps the base entity as `oldEntity` for augmented diffs.
   */
  modify<T extends OsmEntityType>(
    type: T,
    id: number,
    modify: (entity: OsmEntityTypeMap[T]) => OsmEntityTypeMap[T],
  ): void {
    const changes = this.changes(type);
    const change = changes.get(id);
    if (change?.changeType === "delete") {
      throw Error(`Cannot modify ${type} ${id}: entity is scheduled for deletion`);
    }
    const changeEntity = change ? (change.entity as OsmEntityTypeMap[T]) : undefined;
    const existingEntity = changeEntity ?? this.baseEntity(type, id);
    if (existingEntity == null) throw Error("Entity not found");
    const oldEntity = change?.oldEntity ?? (changeEntity ? undefined : existingEntity);

    const modifiedEntity = modify(existingEntity);
    this.write(type, id, {
      changeType: change?.changeType ?? "modify",
      entity: modifiedEntity,
      osmId: this.base.id, // If we're modifying an entity, it must exist in the base OSM
      oldEntity,
    });

    if (type === "node") this.nodeChanged(id, existingEntity as OsmNode);
    else if (type === "way") {
      const previous = existingEntity as OsmWay;
      const next = modifiedEntity as OsmWay;
      if (!dequal(previous.refs, next.refs)) this.invalidateWayGeometry(id);
    }
  }

  /** Schedule an entity for deletion, keeping it as `oldEntity` for augmented diffs. */
  delete(entity: OsmEntity, refs?: OsmEntityRef[]) {
    const type = getEntityType(entity);
    const before = type === "node" ? this.getNode(entity.id) : null;
    this.write(type, entity.id, {
      changeType: "delete",
      entity,
      refs,
      osmId: this.base.id,
      oldEntity: entity,
    });
    if (type === "node") this.nodeChanged(entity.id, before);
    if (type === "way") this.invalidateWayGeometry(entity.id);
  }

  /** Forget a pending record, so the entity reads as it is in the base (or as absent). */
  discard(type: OsmEntityType, id: number) {
    if (this.changes(type).get(id) === undefined) return;
    const before = type === "node" ? this.getNode(id) : null;
    this.write(type, id, undefined);
    if (type === "node") this.nodeChanged(id, before);
    if (type === "way") this.invalidateWayGeometry(id);
  }

  /** The lowest current node ID, or 0 when there is none below it, without reading nodes. */
  minNodeId(): number {
    let minimum = 0;
    const sorted = this.base.nodes.ids.sorted;
    for (let index = 0; index < sorted.length; index++) {
      // Sorted ascending: the first base node not deleted is the lowest.
      const id = sorted[index]!;
      if (id >= minimum) break;
      if (this.nodeChanges.get(id)?.changeType === "delete") continue;
      minimum = id;
      break;
    }
    for (const change of this.nodeChanges.overrideValues()) {
      if (change.changeType !== "delete") minimum = Math.min(minimum, change.entity.id);
    }
    // Untouched layer nodes, lowest first; a dropped one does not count.
    const patchSorted = this.patch?.nodes.ids.sorted ?? [];
    for (let index = 0; index < patchSorted.length; index++) {
      const id = patchSorted[index]!;
      if (id >= minimum) break;
      if (this.base.nodes.ids.has(id) || this.nodeChanges.hasOverride(id)) continue;
      minimum = id;
      break;
    }
    return minimum;
  }

  /** Current nodes: base order first, then created nodes in record order. */
  *nodes(): Generator<OsmNode> {
    for (const node of this.base.nodes) {
      const change = this.nodeChanges.get(node.id);
      if (change?.changeType === "delete") continue;
      yield change?.entity ?? node;
    }
    for (const change of this.nodeChanges.values()) {
      if (this.base.nodes.ids.has(change.entity.id) || change.changeType === "delete") {
        continue;
      }
      yield change.entity;
    }
  }

  /** Current ways: base order first, then created ways in record order. */
  *ways(): Generator<OsmWay> {
    for (const way of this.base.ways) {
      const current = this.currentWay(way);
      if (current) yield current;
    }
    for (const change of this.wayChanges.values()) {
      if (this.base.ways.ids.has(change.entity.id) || change.changeType === "delete") {
        continue;
      }
      yield change.entity;
    }
  }

  /** Current relations: base order first, then created relations in record order. */
  *relations(): Generator<OsmRelation> {
    for (const relation of this.base.relations) {
      const change = this.relationChanges.get(relation.id);
      if (change?.changeType === "delete") continue;
      yield change?.entity ?? relation;
    }
    for (const change of this.relationChanges.values()) {
      if (this.base.relations.ids.has(change.entity.id) || change.changeType === "delete") {
        continue;
      }
      yield change.entity;
    }
  }

  /** A copy of the current records over the same base, unaffected by later changes. */
  snapshot(): PlanOverlay {
    const copy = new PlanOverlay(this.base);
    copy.patch = this.patch;
    copy.layerWaysByForeignNode = this.layerWaysByForeignNode;
    copy.nodeChanges = this.nodeChanges.copy();
    copy.wayChanges = this.wayChanges.copy();
    copy.relationChanges = this.relationChanges.copy();
    return copy;
  }

  /**
   * Drop what this overlay builds from its records to search them: the pending spatial grid,
   * the ways-by-node index and cached way coordinates. Reads rebuild them when needed.
   */
  releaseDerived() {
    this.geometry = undefined;
    this.pendingWayIdsByNode = undefined;
    this.wayCoordinateCache.clear();
    this.packedCoordinateIds.fill(Number.NaN);
    this.packedCoordinates = Array.from({ length: PACKED_COORDINATES_SLOTS });
    this.packedCached = false;
  }

  /** The planned state read by ID, as the materialized dataset would read. */
  reader(): DatasetReader {
    const table = <T>(
      getById: (id: number) => T | null,
      iterate: () => Iterator<T>,
    ): EntityReader<T> => ({
      getById,
      ids: { has: (id) => getById(id) != null },
      [Symbol.iterator]: iterate,
    });
    return {
      id: this.base.id,
      nodes: table(
        (id) => this.getNode(id),
        () => this.nodes(),
      ),
      ways: table(
        (id) => this.getWay(id),
        () => this.ways(),
      ),
      relations: table(
        (id) => this.getRelation(id),
        () => this.relations(),
      ),
    };
  }

  /** How many nodes the planned dataset has. */
  get nodeCount() {
    let count = this.base.nodes.size;
    const patchNodes = this.patch?.nodes;
    // Layer nodes count unless their own record drops or deletes them.
    if (patchNodes) {
      for (let index = 0; index < patchNodes.size; index++) {
        const id = patchNodes.ids.at(index);
        if (!this.base.nodes.ids.has(id) && !this.nodeChanges.hasOverride(id)) count++;
      }
    }
    for (const change of this.nodeChanges.overrideValues()) {
      const inBase = this.base.nodes.ids.has(change.entity.id);
      if (change.changeType === "create" && !inBase) count++;
      else if (change.changeType === "delete" && inBase) count--;
    }
    return count;
  }

  /** Every current way that references `nodeId`, whatever its kind. */
  waysAtNode(nodeId: number): OsmWay[] {
    const ways = new Map<number, OsmWay>();
    const node = this.base.nodes.getById(nodeId);
    if (node) {
      // A pending way can reference a base node only if its record says so, so base geometry
      // at the base position plus pending incidence covers every way.
      for (const index of this.base.ways.intersects([node.lon, node.lat, node.lon, node.lat])) {
        const way = this.currentWay(this.base.ways.getByIndex(index));
        if (way?.refs.includes(nodeId)) ways.set(way.id, way);
      }
    }
    for (const wayId of this.pendingIncidence().get(nodeId) ?? []) {
      const change = this.wayChanges.get(wayId);
      if (change && change.changeType !== "delete" && change.entity.refs.includes(nodeId)) {
        ways.set(change.entity.id, change.entity);
      }
    }
    for (const way of this.layerWaysAt(nodeId)) ways.set(way.id, way);
    return [...ways.values()];
  }

  /**
   * Untouched layer ways that reference `nodeId`, found through the patch's way index at the
   * node's positions (in the base, in the patch, and now).
   */
  private *layerWaysAt(nodeId: number): Generator<OsmWay> {
    const patch = this.patch;
    if (!patch) return;
    const positions = new Map<string, [number, number]>();
    for (const node of [
      this.base.nodes.getById(nodeId),
      patch.nodes.getById(nodeId),
      this.getNode(nodeId),
    ]) {
      if (node) positions.set(`${node.lon},${node.lat}`, [node.lon, node.lat]);
    }
    const seen = new Set<number>();
    for (const id of this.layerWaysByForeignNode.get(nodeId) ?? []) {
      if (this.wayChanges.hasOverride(id)) continue;
      seen.add(id);
      const way = this.wayChanges.get(id)?.entity;
      if (way?.refs.includes(nodeId)) yield way;
    }
    for (const [lon, lat] of positions.values()) {
      for (const index of patch.ways.intersects([lon, lat, lon, lat])) {
        const id = patch.ways.ids.at(index);
        if (seen.has(id) || this.wayChanges.hasOverride(id)) continue;
        seen.add(id);
        const way = this.wayChanges.get(id)?.entity;
        if (way?.refs.includes(nodeId)) yield way;
      }
    }
  }

  /**
   * IDs of pending (created or changed) ways whose current refs include `nodeId`. For a node
   * the base does not have, these are every way at it, without a spatial query.
   */
  pendingWayIdsAt(nodeId: number): ReadonlySet<number> {
    const own = this.pendingIncidence().get(nodeId) ?? EMPTY_IDS;
    if (!this.patch) return own;
    const ids = new Set(own);
    for (const way of this.layerWaysAt(nodeId)) ids.add(way.id);
    return ids;
  }

  /**
   * A way's current coordinates, or null when any ref is unavailable; geometry is never
   * substituted.
   */
  wayCoordinates(way: OsmWay): [number, number][] | null {
    const wayRevision = this.wayGeometryRevisions.get(way.id) ?? 0;
    const cached = this.cachedCoordinates(way.id);
    if (cached && cached.wayRevision === wayRevision) return cached.coordinates;

    // Unchanged base geometry can resolve packed node indexes directly, avoiding one binary ID
    // lookup per ref. Match the fallback's missing-ref behavior by requiring every ref.
    if (
      this.wayChanges.get(way.id) === undefined &&
      way.refs.every((ref) => this.nodeChanges.get(ref) === undefined)
    ) {
      const [wayIndex] = this.base.ways.ids.idOrIndex({ id: way.id });
      if (wayIndex !== -1) {
        const coordinates = this.base.ways.getResolvedCoordinates(wayIndex);
        if (coordinates.length !== way.refs.length) return null;
        this.cachePackedCoordinates(way.id, { coordinates, wayRevision });
        return coordinates;
      }
    }
    // An untouched layer way over untouched layer nodes reads its packed patch coordinates.
    const patch = this.patch;
    if (
      patch &&
      !this.wayChanges.hasOverride(way.id) &&
      this.wayChanges.get(way.id) !== undefined &&
      way.refs.every((ref) => !this.nodeChanges.hasOverride(ref) && !this.base.nodes.ids.has(ref))
    ) {
      const [wayIndex] = patch.ways.ids.idOrIndex({ id: way.id });
      if (wayIndex !== -1) {
        const coordinates = patch.ways.getResolvedCoordinates(wayIndex);
        // A patch way with repeated refs reads with them removed; resolve those by node.
        if (coordinates.length === way.refs.length) {
          this.cachePackedCoordinates(way.id, { coordinates, wayRevision });
          return coordinates;
        }
      }
    }

    const coordinates: [number, number][] = [];
    for (const ref of way.refs) {
      const node = this.getNode(ref);
      // Do not cache unresolved geometry: a later node creation can make this same set of refs
      // resolvable without changing the way revision.
      if (!node) return null;
      coordinates.push([node.lon, node.lat]);
    }
    this.wayCoordinateCache.set(way.id, { coordinates, wayRevision });
    return coordinates;
  }

  /** `wayCoordinates` without consecutive duplicates, cached alongside them. */
  cleanWayCoordinates(way: OsmWay): [number, number][] | null {
    const coordinates = this.wayCoordinates(way);
    if (!coordinates) return null;
    const cached = this.cachedCoordinates(way.id);
    if (!cached || cached.coordinates !== coordinates) return cleanCoords(coordinates);
    return (cached.cleaned ??= cleanCoords(coordinates));
  }

  private cachedCoordinates(id: number): WayCoordinateCacheEntry | undefined {
    const slot = packedSlot(id);
    if (this.packedCoordinateIds[slot] === id) return this.packedCoordinates[slot];
    return this.wayCoordinateCache.get(id);
  }

  private cachePackedCoordinates(id: number, entry: WayCoordinateCacheEntry) {
    const slot = packedSlot(id);
    this.packedCoordinateIds[slot] = id;
    this.packedCoordinates[slot] = entry;
    this.packedCached = true;
  }

  private forgetCoordinates(id: number) {
    this.wayCoordinateCache.delete(id);
    const slot = packedSlot(id);
    if (this.packedCoordinateIds[slot] === id) this.packedCoordinateIds[slot] = Number.NaN;
  }

  /** The bounding box of a way's resolvable refs, or null when none resolve. */
  wayBbox(way: OsmWay): GeoBbox2D | null {
    let bbox: GeoBbox2D | null = null;
    for (const ref of way.refs) {
      const node = this.getNode(ref);
      if (!node) continue;
      if (!bbox) bbox = [node.lon, node.lat, node.lon, node.lat];
      else {
        bbox[0] = Math.min(bbox[0], node.lon);
        bbox[1] = Math.min(bbox[1], node.lat);
        bbox[2] = Math.max(bbox[2], node.lon);
        bbox[3] = Math.max(bbox[3], node.lat);
      }
    }
    return bbox;
  }

  /** Current nodes within `meters` of a point, nearest first, ties by ID. */
  nodesWithinRadius(lon: number, lat: number, meters: number): OsmNode[] {
    const geometry = this.pendingGeometry();
    const matches: { distance: number; node: OsmNode }[] = [];
    for (const index of this.base.nodes.findIndexesWithinRadius(lon, lat, meters / 1_000)) {
      const node = this.base.nodes.getByIndex(index);
      if (this.nodeChanges.get(node.id)) continue;
      matches.push({ distance: haversineDistance([lon, lat], [node.lon, node.lat]), node });
    }
    // Untouched layer nodes come from the patch's index; the grid holds every node with a record.
    const patch = this.patch;
    if (patch) {
      for (const index of patch.nodes.findIndexesWithinRadius(lon, lat, meters / 1_000)) {
        const id = patch.nodes.ids.at(index);
        if (this.base.nodes.ids.has(id) || this.nodeChanges.hasOverride(id)) continue;
        const node = patch.nodes.getByIndex(index);
        matches.push({ distance: haversineDistance([lon, lat], [node.lon, node.lat]), node });
      }
    }
    const latDelta = (meters / METERS_PER_DEGREE_LAT) * 1.01;
    const lonDelta = Math.min(180, latDelta / Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));
    for (const id of geometry.nodes.query([
      lon - lonDelta,
      lat - latDelta,
      lon + lonDelta,
      lat + latDelta,
    ])) {
      const node = this.getNode(id);
      if (!node) continue;
      const distance = haversineDistance([lon, lat], [node.lon, node.lat]);
      if (distance <= meters) matches.push({ distance, node });
    }
    matches.sort((a, b) => a.distance - b.distance || a.node.id - b.node.id);
    return matches.map(({ node }) => node);
  }

  /** Current ways whose bounding box intersects `bbox`, in ID order. */
  waysIntersecting(bbox: GeoBbox2D): OsmWay[] {
    return this.wayIdsIntersecting(bbox).flatMap((id) => this.getWay(id) ?? []);
  }

  /**
   * IDs of current ways whose bounding box intersects `bbox`, in ID order, without reading the
   * ways. Pending ways are tested against the box the grid keeps current for them.
   */
  wayIdsIntersecting(bbox: GeoBbox2D): number[] {
    const geometry = this.pendingGeometry();
    const ids: number[] = [];
    for (const index of this.base.ways.intersects(bbox)) {
      const id = this.base.ways.ids.at(index);
      if (!geometry.trackedWays.has(id)) ids.push(id);
    }
    const patch = this.patch;
    if (patch) {
      for (const index of patch.ways.intersects(bbox)) {
        const id = patch.ways.ids.at(index);
        if (this.base.ways.ids.has(id) || geometry.trackedWays.has(id)) continue;
        if (this.wayChanges.get(id) !== undefined) ids.push(id);
      }
    }
    for (const id of geometry.ways.query(bbox)) ids.push(id);
    return ids.sort((a, b) => a - b);
  }

  private pendingIncidence() {
    if (!this.pendingWayIdsByNode) {
      this.pendingWayIdsByNode = new Map();
      for (const id of this.wayChanges.overrideKeys()) this.updatePendingWayIncidence(id);
    }
    return this.pendingWayIdsByNode;
  }

  private pendingGeometry(): PendingGeometry {
    if (this.geometry) return this.geometry;
    const geometry: PendingGeometry = {
      nodes: new GridIndex(),
      ways: new GridIndex(),
      trackedWays: new Set(),
    };
    this.geometry = geometry;
    const movedNodes: number[] = [];
    for (const change of this.nodeChanges.overrideValues()) {
      const node = change.entity;
      if (change.changeType !== "delete") {
        geometry.nodes.set(node.id, [node.lon, node.lat, node.lon, node.lat]);
      }
      const before = this.base.nodes.getById(node.id) ?? this.patch?.nodes.getById(node.id);
      if (
        change.changeType === "delete" ||
        (before && (before.lon !== node.lon || before.lat !== node.lat))
      ) {
        movedNodes.push(node.id);
      }
    }
    // A dropped layer node is gone from where the patch index finds it.
    for (const id of this.nodeChanges.overrideKeys()) {
      if (!this.nodeChanges.get(id) && this.patch?.nodes.ids.has(id)) movedNodes.push(id);
    }
    for (const id of this.wayChanges.overrideKeys()) this.trackWay(id);
    // The patch's index boxes a way by its own nodes; one that also uses base nodes is boxed here.
    for (const ids of this.layerWaysByForeignNode.values()) for (const id of ids) this.trackWay(id);
    for (const id of movedNodes) {
      for (const way of this.waysAtNode(id)) this.trackWay(way.id);
    }
    return geometry;
  }

  /** Index a way by its current geometry, so base results for it are ignored. */
  private trackWay(id: number) {
    const geometry = this.geometry;
    if (!geometry) return;
    geometry.trackedWays.add(id);
    const way = this.getWay(id);
    const bbox = way ? this.wayBbox(way) : null;
    if (bbox) geometry.ways.set(id, bbox);
    else geometry.ways.remove(id);
  }

  /**
   * A node record was written. When its position changed, appeared or disappeared, the ways at
   * it lose their cached coordinates and their geometry follows; other ways keep theirs.
   */
  private nodeChanged(id: number, before: OsmNode | null) {
    const node = this.getNode(id);
    const geometry = this.geometry;
    // The node grid holds nodes with a live record; the base index answers for the rest.
    if (geometry) {
      const record = this.nodeChanges.hasOverride(id) ? this.nodeChanges.get(id) : undefined;
      if (node && record && record.changeType !== "delete") {
        geometry.nodes.set(id, [node.lon, node.lat, node.lon, node.lat]);
      } else geometry.nodes.remove(id);
    }
    const moved = !before || !node || before.lon !== node.lon || before.lat !== node.lat;
    if (!moved || (!geometry && this.wayCoordinateCache.size === 0 && !this.packedCached)) return;
    // Base geometry at the base position plus pending incidence finds every way at the node,
    // including ways whose bbox a deleted vertex no longer counts toward.
    for (const way of this.waysAtNode(id)) {
      this.wayGeometryRevisions.set(way.id, (this.wayGeometryRevisions.get(way.id) ?? 0) + 1);
      this.forgetCoordinates(way.id);
      this.trackWay(way.id);
    }
  }

  private invalidateWayGeometry(wayId: number) {
    this.wayGeometryRevisions.set(wayId, (this.wayGeometryRevisions.get(wayId) ?? 0) + 1);
    this.forgetCoordinates(wayId);
    this.updatePendingWayIncidence(wayId);
    this.trackWay(wayId);
  }

  private updatePendingWayIncidence(wayId: number) {
    const index = this.pendingWayIdsByNode;
    if (!index) return;
    for (const ref of this.pendingWayRefs.get(wayId) ?? []) {
      const wayIds = index.get(ref);
      wayIds?.delete(wayId);
      if (wayIds?.size === 0) index.delete(ref);
    }
    this.pendingWayRefs.delete(wayId);
    const change = this.wayChanges.hasOverride(wayId) ? this.wayChanges.get(wayId) : undefined;
    if (!change || change.changeType === "delete") return;
    this.pendingWayRefs.set(wayId, change.entity.refs);
    for (const ref of change.entity.refs) {
      const wayIds = index.get(ref) ?? new Set<number>();
      wayIds.add(wayId);
      index.set(ref, wayIds);
    }
  }
}

/** A copied state as an earlier state of `live`: what either has a record for may differ. */
export function snapshotState(snapshot: PlanOverlay, live: PlanOverlay): EarlierState {
  return {
    getNode: (id) => snapshot.getNode(id),
    getWay: (id) => snapshot.getWay(id),
    getRelation: (id) => snapshot.getRelation(id),
    changedIds: (type) =>
      new Set([...snapshot.changes(type).overrideKeys(), ...live.changes(type).overrideKeys()]),
  };
}

/** An earlier state read by ID; it has no order to iterate in, so iterating throws. */
export function earlierStateReader(state: EarlierState, id: string): DatasetReader {
  const table = <T>(getById: (id: number) => T | null): EntityReader<T> => ({
    getById,
    ids: { has: (key) => getById(key) != null },
    [Symbol.iterator]: () => {
      throw Error("An earlier plan state is read by ID only");
    },
  });
  return {
    id,
    nodes: table((key) => state.getNode(key)),
    ways: table((key) => state.getWay(key)),
    relations: table((key) => state.getRelation(key)),
  };
}
