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
import { bboxContainsOrIntersects } from "@osmix/geo/bbox-intersects";
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

import type { OsmChange, OsmEntityRef } from "../types.ts";
import { cleanCoords } from "../utils.ts";
import type { DatasetReader, EntityReader } from "../views.ts";
import { GridIndex } from "./grid-index.ts";

type ChangeRecords<T extends OsmEntityType> = Record<number, OsmChange<OsmEntityTypeMap[T]>>;

interface WayCoordinateCacheEntry {
  cleaned?: [number, number][];
  coordinates: [number, number][] | null;
  nodeCoordinateRevision: number;
  wayRevision: number;
}

/** Pending geometry, built on the first spatial query and maintained on every change after. */
interface PendingGeometry {
  nodes: GridIndex;
  ways: GridIndex;
  /** Ways whose base geometry no longer applies: changed records, or a vertex moved. */
  trackedWays: Set<number>;
}

const METERS_PER_DEGREE_LAT = 111_320;

export class PlanOverlay {
  nodeChanges: ChangeRecords<"node"> = {};
  wayChanges: ChangeRecords<"way"> = {};
  relationChanges: ChangeRecords<"relation"> = {};

  /** Revisions keep geometry caches correct while phases rewrite ways in place. */
  private nodeCoordinateRevision = 0;
  private readonly wayGeometryRevisions = new Map<number, number>();
  private pendingWayIdsByNode: Map<number, Set<number>> | undefined;
  private readonly pendingWayRefs = new Map<number, readonly number[]>();
  private readonly wayCoordinateCache = new Map<number, WayCoordinateCacheEntry>();
  private geometry: PendingGeometry | undefined;

  readonly base: Osm;

  constructor(base: Osm) {
    this.base = base;
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

  /** Replace one type's records wholesale (restoring a snapshot), dropping derived caches. */
  setRecords<T extends OsmEntityType>(type: T, records: ChangeRecords<T>) {
    if (type === "node") {
      this.nodeChanges = records as ChangeRecords<"node">;
      // Keep packed base-coordinate reuse while no node record exists.
      if (Object.keys(records).length > 0) this.nodeCoordinateRevision++;
    } else if (type === "way") {
      this.wayChanges = records as ChangeRecords<"way">;
      this.wayCoordinateCache.clear();
      this.pendingWayIdsByNode = undefined;
      this.pendingWayRefs.clear();
    } else {
      this.relationChanges = records as ChangeRecords<"relation">;
    }
    this.geometry = undefined;
  }

  /** The entity as stored in the base, ignoring records. */
  baseEntity<T extends OsmEntityType>(type: T, id: number): OsmEntityTypeMap[T] | undefined {
    if (type === "node") return this.base.nodes.get({ id }) as OsmEntityTypeMap[T];
    if (type === "way") return this.base.ways.get({ id }) as OsmEntityTypeMap[T];
    return this.base.relations.get({ id }) as OsmEntityTypeMap[T];
  }

  getNode(id: number): OsmNode | null {
    const change = this.nodeChanges[id];
    if (change?.changeType === "delete") return null;
    return change?.entity ?? this.base.nodes.getById(id);
  }

  getWay(id: number): OsmWay | null {
    const change = this.wayChanges[id];
    if (change?.changeType === "delete") return null;
    return change?.entity ?? this.base.ways.getById(id);
  }

  getRelation(id: number): OsmRelation | null {
    const change = this.relationChanges[id];
    if (change?.changeType === "delete") return null;
    return change?.entity ?? this.base.relations.getById(id);
  }

  /** The current version of an already decoded way; skips a second base lookup. */
  currentWay(way: OsmWay): OsmWay | null {
    const change = this.wayChanges[way.id];
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
    this.changes(type)[entity.id] = {
      changeType: "create",
      entity,
      osmId,
      refs, // Refs can come from other datasets, useful for tracking provenance
    };
    if (type === "node" && options.unreferenced) {
      const node = entity as OsmNode;
      this.geometry?.nodes.set(node.id, [node.lon, node.lat, node.lon, node.lat]);
    } else if (type === "node") this.nodeMoved(entity.id);
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
    const change = changes[id];
    if (change?.changeType === "delete") {
      throw Error(`Cannot modify ${type} ${id}: entity is scheduled for deletion`);
    }
    const changeEntity = change ? (change.entity as OsmEntityTypeMap[T]) : undefined;
    const existingEntity = changeEntity ?? this.baseEntity(type, id);
    if (existingEntity == null) throw Error("Entity not found");
    const oldEntity = change?.oldEntity ?? (changeEntity ? undefined : existingEntity);

    const modifiedEntity = modify(existingEntity);
    changes[id] = {
      changeType: change?.changeType ?? "modify",
      entity: modifiedEntity,
      osmId: this.base.id, // If we're modifying an entity, it must exist in the base OSM
      oldEntity,
    };

    if (type === "node") {
      const previous = existingEntity as OsmNode;
      const next = modifiedEntity as OsmNode;
      if (previous.lon !== next.lon || previous.lat !== next.lat) this.nodeMoved(id);
      else this.geometry?.nodes.set(id, [next.lon, next.lat, next.lon, next.lat]);
    } else if (type === "way") {
      const previous = existingEntity as OsmWay;
      const next = modifiedEntity as OsmWay;
      if (!dequal(previous.refs, next.refs)) this.invalidateWayGeometry(id);
    }
  }

  /** Schedule an entity for deletion, keeping it as `oldEntity` for augmented diffs. */
  delete(entity: OsmEntity, refs?: OsmEntityRef[]) {
    const type = getEntityType(entity);
    this.changes(type)[entity.id] = {
      changeType: "delete",
      entity,
      refs,
      osmId: this.base.id,
      oldEntity: entity,
    };
    if (type === "node") this.nodeMoved(entity.id);
    if (type === "way") this.invalidateWayGeometry(entity.id);
  }

  /** Forget a pending record, so the entity reads as it is in the base (or as absent). */
  discard(type: OsmEntityType, id: number) {
    if (!(id in this.changes(type))) return;
    delete this.changes(type)[id];
    if (type === "node") this.nodeMoved(id);
    if (type === "way") this.invalidateWayGeometry(id);
  }

  /** Current nodes: base order first, then created nodes in record order. */
  *nodes(): Generator<OsmNode> {
    for (const node of this.base.nodes) {
      const change = this.nodeChanges[node.id];
      if (change?.changeType === "delete") continue;
      yield change?.entity ?? node;
    }
    for (const change of Object.values(this.nodeChanges)) {
      if (this.base.nodes.ids.has(change.entity.id) || change.changeType === "delete") continue;
      yield change.entity;
    }
  }

  /** Current ways: base order first, then created ways in record order. */
  *ways(): Generator<OsmWay> {
    for (const way of this.base.ways) {
      const current = this.currentWay(way);
      if (current) yield current;
    }
    for (const change of Object.values(this.wayChanges)) {
      if (this.base.ways.ids.has(change.entity.id) || change.changeType === "delete") continue;
      yield change.entity;
    }
  }

  /** Current relations: base order first, then created relations in record order. */
  *relations(): Generator<OsmRelation> {
    for (const relation of this.base.relations) {
      const change = this.relationChanges[relation.id];
      if (change?.changeType === "delete") continue;
      yield change?.entity ?? relation;
    }
    for (const change of Object.values(this.relationChanges)) {
      if (this.base.relations.ids.has(change.entity.id) || change.changeType === "delete") continue;
      yield change.entity;
    }
  }

  /** A copy of the current records over the same base, unaffected by later changes. */
  snapshot(): PlanOverlay {
    const copy = new PlanOverlay(this.base);
    copy.nodeChanges = { ...this.nodeChanges };
    copy.wayChanges = { ...this.wayChanges };
    copy.relationChanges = { ...this.relationChanges };
    if (Object.keys(copy.nodeChanges).length > 0) copy.nodeCoordinateRevision++;
    return copy;
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
    for (const change of Object.values(this.nodeChanges)) {
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
      const change = this.wayChanges[wayId];
      if (change && change.changeType !== "delete" && change.entity.refs.includes(nodeId)) {
        ways.set(change.entity.id, change.entity);
      }
    }
    return [...ways.values()];
  }

  /**
   * A way's current coordinates, or null when any ref is unavailable; geometry is never
   * substituted.
   */
  wayCoordinates(way: OsmWay): [number, number][] | null {
    const wayRevision = this.wayGeometryRevisions.get(way.id) ?? 0;
    const cached = this.wayCoordinateCache.get(way.id);
    if (
      cached &&
      cached.wayRevision === wayRevision &&
      cached.nodeCoordinateRevision === this.nodeCoordinateRevision
    ) {
      return cached.coordinates;
    }

    // Unchanged base geometry can resolve packed node indexes directly, avoiding one binary ID
    // lookup per ref. Match the fallback's missing-ref behavior by requiring every ref.
    if (this.nodeCoordinateRevision === 0 && this.wayChanges[way.id] === undefined) {
      const [wayIndex] = this.base.ways.ids.idOrIndex({ id: way.id });
      if (wayIndex !== -1) {
        const coordinates = this.base.ways.getResolvedCoordinates(wayIndex);
        if (coordinates.length !== way.refs.length) return null;
        this.wayCoordinateCache.set(way.id, {
          coordinates,
          nodeCoordinateRevision: this.nodeCoordinateRevision,
          wayRevision,
        });
        return coordinates;
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
    this.wayCoordinateCache.set(way.id, {
      coordinates,
      nodeCoordinateRevision: this.nodeCoordinateRevision,
      wayRevision,
    });
    return coordinates;
  }

  /** `wayCoordinates` without consecutive duplicates, cached alongside them. */
  cleanWayCoordinates(way: OsmWay): [number, number][] | null {
    const coordinates = this.wayCoordinates(way);
    if (!coordinates) return null;
    const cached = this.wayCoordinateCache.get(way.id);
    if (!cached) return cleanCoords(coordinates);
    return (cached.cleaned ??= cleanCoords(coordinates));
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
      if (this.nodeChanges[node.id]) continue;
      matches.push({ distance: haversineDistance([lon, lat], [node.lon, node.lat]), node });
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
    const geometry = this.pendingGeometry();
    const ways: OsmWay[] = [];
    for (const index of this.base.ways.intersects(bbox)) {
      const id = this.base.ways.ids.at(index);
      if (!geometry.trackedWays.has(id)) ways.push(this.base.ways.getByIndex(index));
    }
    for (const id of geometry.ways.query(bbox)) {
      const way = this.getWay(id);
      const wayBbox = way ? this.wayBbox(way) : null;
      if (way && wayBbox && bboxContainsOrIntersects(wayBbox, bbox)) ways.push(way);
    }
    return ways.sort((a, b) => a.id - b.id);
  }

  private pendingIncidence() {
    if (!this.pendingWayIdsByNode) {
      this.pendingWayIdsByNode = new Map();
      for (const change of Object.values(this.wayChanges)) {
        this.updatePendingWayIncidence(change.entity.id);
      }
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
    for (const change of Object.values(this.nodeChanges)) {
      const node = change.entity;
      if (change.changeType !== "delete") {
        geometry.nodes.set(node.id, [node.lon, node.lat, node.lon, node.lat]);
      }
      const base = this.base.nodes.getById(node.id);
      if (
        change.changeType === "delete" ||
        (base && (base.lon !== node.lon || base.lat !== node.lat))
      ) {
        movedNodes.push(node.id);
      }
    }
    for (const change of Object.values(this.wayChanges)) this.trackWay(change.entity.id);
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

  /** A node's position changed, appeared or disappeared: its ways' geometry follows. */
  private nodeMoved(id: number) {
    this.nodeCoordinateRevision++;
    const geometry = this.geometry;
    if (!geometry) return;
    const node = this.getNode(id);
    if (node) geometry.nodes.set(id, [node.lon, node.lat, node.lon, node.lat]);
    else geometry.nodes.remove(id);
    // Base geometry at the base position plus pending incidence finds every way at the node,
    // including ways whose bbox a deleted vertex no longer counts toward.
    for (const way of this.waysAtNode(id)) this.trackWay(way.id);
  }

  private invalidateWayGeometry(wayId: number) {
    this.wayGeometryRevisions.set(wayId, (this.wayGeometryRevisions.get(wayId) ?? 0) + 1);
    this.wayCoordinateCache.delete(wayId);
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
    const change = this.wayChanges[wayId];
    if (!change || change.changeType === "delete") return;
    this.pendingWayRefs.set(wayId, change.entity.refs);
    for (const ref of change.entity.refs) {
      const wayIds = index.get(ref) ?? new Set<number>();
      wayIds.add(wayId);
      index.set(ref, wayIds);
    }
  }
}
