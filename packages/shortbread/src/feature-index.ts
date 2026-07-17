import { BufferConstructor, type BufferType, type OsmReader } from "@osmix/core";
import { wayIsArea } from "@osmix/geo/way-is-area";
import type { GeoBbox2D, OsmTags } from "@osmix/types";
import { isAreaRelation, isLineRelation, isPointRelation } from "@osmix/types/relation-kind";
import Flatbush from "flatbush";

import { matchTags, SHORTBREAD_LAYERS } from "./layers.ts";
import type { ShortbreadGeometryType, ShortbreadLayerName } from "./types.ts";

export const SHORTBREAD_GEOMETRY_MASK = {
  POINT: 1,
  LINE_STRING: 2,
  POLYGON: 4,
} as const;

const ENTITY_TYPE = {
  NODE: 0,
  WAY: 1,
  RELATION: 2,
} as const;

type EncodedEntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];

export type ShortbreadFeatureEntityType = "node" | "way" | "relation";

export interface ShortbreadFeatureRecord {
  entityIndex: number;
  entityType: ShortbreadFeatureEntityType;
  geometryMask: number;
  layerMask: number;
  bbox: GeoBbox2D;
}

/** Spatial and semantic filters evaluated before feature records are materialized. */
export interface ShortbreadFeatureQuery {
  bbox: GeoBbox2D;
  /** Include records matching any listed entity kind. Defaults to every kind. */
  entityTypes?: readonly ShortbreadFeatureEntityType[];
  /** Include records sharing at least one requested geometry bit. */
  geometryMask?: number;
  /** Include records classified into at least one requested Shortbread layer. */
  layers?: readonly ShortbreadLayerName[];
}

export interface ShortbreadFeatureIndexTransferables<T extends BufferType = BufferType> {
  bboxes: T;
  entityIndexes: T;
  entityTypes: T;
  geometryMasks: T;
  layerMasks: T;
  spatialIndex?: T;
  suppressedAreaWayIds: T;
  /** Layer masks aligned with `suppressedAreaWayIds`. Absent only in legacy descriptors. */
  suppressedAreaWayLayerMasks?: T;
}

interface MutableRecord {
  bbox: GeoBbox2D;
  entityIndex: number;
  entityType: EncodedEntityType;
  geometryMask: number;
  layerMask: number;
}

const geometryMaskByType: Record<ShortbreadGeometryType, number> = {
  Point: SHORTBREAD_GEOMETRY_MASK.POINT,
  LineString: SHORTBREAD_GEOMETRY_MASK.LINE_STRING,
  Polygon: SHORTBREAD_GEOMETRY_MASK.POLYGON,
};

const layerBits = new Map<ShortbreadLayerName, number>(
  SHORTBREAD_LAYERS.map((layer, index) => [layer.name, (1 << index) >>> 0]),
);

function sharedUint8(values: number[]): Uint8Array<BufferType> {
  const result = new Uint8Array(new BufferConstructor(values.length));
  result.set(values);
  return result;
}

function sharedUint32(values: number[]): Uint32Array<BufferType> {
  const result = new Uint32Array(
    new BufferConstructor(values.length * Uint32Array.BYTES_PER_ELEMENT),
  );
  result.set(values);
  return result;
}

function sharedFloat64(values: number[]): Float64Array<BufferType> {
  const result = new Float64Array(
    new BufferConstructor(values.length * Float64Array.BYTES_PER_ELEMENT),
  );
  result.set(values);
  return result;
}

function layerMask(tags: OsmTags, geometryType: ShortbreadGeometryType): number {
  let mask = 0;
  for (const match of matchTags(tags, geometryType)) {
    mask = (mask | (layerBits.get(match.layer.name) ?? 0)) >>> 0;
  }
  return mask;
}

function validBbox(bbox: GeoBbox2D): boolean {
  return bbox.every(Number.isFinite) && bbox[0] <= bbox[2] && bbox[1] <= bbox[3];
}

function entityTypeName(value: EncodedEntityType): ShortbreadFeatureEntityType {
  if (value === ENTITY_TYPE.NODE) return "node";
  if (value === ENTITY_TYPE.WAY) return "way";
  return "relation";
}

function encodedEntityType(value: ShortbreadFeatureEntityType): EncodedEntityType {
  if (value === "node") return ENTITY_TYPE.NODE;
  if (value === "way") return ENTITY_TYPE.WAY;
  return ENTITY_TYPE.RELATION;
}

function queryLayerMask(layers: readonly ShortbreadLayerName[] | undefined): number | undefined {
  if (!layers) return undefined;
  let mask = 0;
  for (const layer of layers) mask = (mask | (layerBits.get(layer) ?? 0)) >>> 0;
  return mask;
}

/** Return every distinct backing buffer used by serialized index state. */
export function getShortbreadFeatureIndexBuffers(
  transferables: ShortbreadFeatureIndexTransferables,
): BufferType[] {
  return [
    transferables.bboxes,
    transferables.entityIndexes,
    transferables.entityTypes,
    transferables.geometryMasks,
    transferables.layerMasks,
    ...(transferables.spatialIndex ? [transferables.spatialIndex] : []),
    transferables.suppressedAreaWayIds,
    ...(transferables.suppressedAreaWayLayerMasks
      ? [transferables.suppressedAreaWayLayerMasks]
      : []),
  ];
}

/** Compact transferable classification and spatial index for Shortbread candidates. */
export class ShortbreadFeatureIndex {
  readonly size: number;
  private readonly bboxes: Float64Array<BufferType>;
  private readonly entityIndexes: Uint32Array<BufferType>;
  private readonly entityTypes: Uint8Array<BufferType>;
  private readonly geometryMasks: Uint8Array<BufferType>;
  private readonly layerMasks: Uint32Array<BufferType>;
  private readonly spatialIndex: Flatbush | null;
  private readonly suppressedAreaWayIds: Float64Array<BufferType>;
  private readonly suppressedAreaWayLayerMasks: Uint32Array<BufferType>;

  private constructor(
    bboxes: Float64Array<BufferType>,
    entityIndexes: Uint32Array<BufferType>,
    entityTypes: Uint8Array<BufferType>,
    geometryMasks: Uint8Array<BufferType>,
    layerMasks: Uint32Array<BufferType>,
    spatialIndex: Flatbush | null,
    suppressedAreaWayIds: Float64Array<BufferType>,
    suppressedAreaWayLayerMasks: Uint32Array<BufferType>,
  ) {
    this.bboxes = bboxes;
    this.entityIndexes = entityIndexes;
    this.entityTypes = entityTypes;
    this.geometryMasks = geometryMasks;
    this.layerMasks = layerMasks;
    this.spatialIndex = spatialIndex;
    this.suppressedAreaWayIds = suppressedAreaWayIds;
    this.suppressedAreaWayLayerMasks = suppressedAreaWayLayerMasks;
    this.size = entityIndexes.length;
  }

  static build(osm: OsmReader): ShortbreadFeatureIndex {
    const records: MutableRecord[] = [];
    const suppressedAreaWayLayerMasks = new Map<number, number>();

    for (let entityIndex = 0; entityIndex < osm.nodes.size; entityIndex++) {
      if (osm.nodes.tags.cardinality(entityIndex) === 0) continue;
      const tags = osm.nodes.tags.getTags(entityIndex);
      if (!tags) continue;
      const mask = layerMask(tags, "Point");
      if (mask === 0) continue;
      const bbox = osm.nodes.getEntityBbox({ index: entityIndex });
      if (!validBbox(bbox)) continue;
      records.push({
        bbox,
        entityIndex,
        entityType: ENTITY_TYPE.NODE,
        geometryMask: SHORTBREAD_GEOMETRY_MASK.POINT,
        layerMask: mask,
      });
    }

    for (let entityIndex = 0; entityIndex < osm.ways.size; entityIndex++) {
      if (osm.ways.tags.cardinality(entityIndex) === 0) continue;
      const tags = osm.ways.tags.getTags(entityIndex);
      if (!tags) continue;
      const id = osm.ways.ids.at(entityIndex);
      const isArea = wayIsArea({
        id,
        refs: osm.ways.getRefIds(entityIndex),
        tags,
      });
      const geometryType = isArea ? "Polygon" : "LineString";
      const mask = layerMask(tags, geometryType);
      if (mask === 0) continue;
      const bbox = osm.ways.getEntityBbox({ index: entityIndex });
      if (!validBbox(bbox)) continue;
      records.push({
        bbox,
        entityIndex,
        entityType: ENTITY_TYPE.WAY,
        geometryMask: geometryMaskByType[geometryType],
        layerMask: mask,
      });
    }

    for (let entityIndex = 0; entityIndex < osm.relations.size; entityIndex++) {
      if (osm.relations.tags.cardinality(entityIndex) === 0) continue;
      const relation = osm.relations.getByIndex(entityIndex);
      const tags = relation.tags;
      if (!tags) continue;

      let geometryType: ShortbreadGeometryType | null = null;
      if (isAreaRelation(relation)) geometryType = "Polygon";
      else if (isLineRelation(relation)) geometryType = "LineString";
      else if (isPointRelation(relation)) geometryType = "Point";
      if (!geometryType) continue;

      const mask = layerMask(tags, geometryType);
      if (mask === 0) continue;
      const geometry = osm.relations.getRelationGeometry(entityIndex);
      const suppliesGeometry =
        (geometryType === "Polygon" && (geometry.rings?.length ?? 0) > 0) ||
        (geometryType === "LineString" && (geometry.lineStrings?.length ?? 0) > 0) ||
        (geometryType === "Point" && (geometry.points?.length ?? 0) > 0);
      if (!suppliesGeometry) continue;

      const bbox = osm.relations.getEntityBbox({ index: entityIndex });
      if (!validBbox(bbox)) continue;
      records.push({
        bbox,
        entityIndex,
        entityType: ENTITY_TYPE.RELATION,
        geometryMask: geometryMaskByType[geometryType],
        layerMask: mask,
      });

      if (geometryType === "Polygon") {
        for (const member of osm.relations.getMembersByIndex(entityIndex)) {
          if (member.type !== "way") continue;
          const previousMask = suppressedAreaWayLayerMasks.get(member.ref) ?? 0;
          suppressedAreaWayLayerMasks.set(member.ref, (previousMask | mask) >>> 0);
        }
      }
    }

    const bboxes = records.flatMap((record) => record.bbox);
    let spatialIndex: Flatbush | null = null;
    if (records.length > 0) {
      spatialIndex = new Flatbush(records.length, 64, Float64Array, BufferConstructor);
      for (const record of records) spatialIndex.add(...record.bbox);
      spatialIndex.finish();
    }

    const suppressions = [...suppressedAreaWayLayerMasks].sort(([a], [b]) => a - b);

    return new ShortbreadFeatureIndex(
      sharedFloat64(bboxes),
      sharedUint32(records.map((record) => record.entityIndex)),
      sharedUint8(records.map((record) => record.entityType)),
      sharedUint8(records.map((record) => record.geometryMask)),
      sharedUint32(records.map((record) => record.layerMask)),
      spatialIndex,
      sharedFloat64(suppressions.map(([id]) => id)),
      sharedUint32(suppressions.map(([, mask]) => mask)),
    );
  }

  static fromTransferables(
    transferables: ShortbreadFeatureIndexTransferables,
  ): ShortbreadFeatureIndex {
    const suppressedAreaWayIds = new Float64Array(transferables.suppressedAreaWayIds);
    const suppressedAreaWayLayerMasks = transferables.suppressedAreaWayLayerMasks
      ? new Uint32Array(transferables.suppressedAreaWayLayerMasks)
      : new Uint32Array(suppressedAreaWayIds.length).fill(0xffff_ffff);

    return new ShortbreadFeatureIndex(
      new Float64Array(transferables.bboxes),
      new Uint32Array(transferables.entityIndexes),
      new Uint8Array(transferables.entityTypes),
      new Uint8Array(transferables.geometryMasks),
      new Uint32Array(transferables.layerMasks),
      transferables.spatialIndex ? Flatbush.from(transferables.spatialIndex) : null,
      suppressedAreaWayIds,
      suppressedAreaWayLayerMasks,
    );
  }

  query(bbox: GeoBbox2D): ShortbreadFeatureRecord[];
  query(query: ShortbreadFeatureQuery): ShortbreadFeatureRecord[];
  query(bboxOrQuery: GeoBbox2D | ShortbreadFeatureQuery): ShortbreadFeatureRecord[] {
    if (!this.spatialIndex) return [];
    const query: ShortbreadFeatureQuery = Array.isArray(bboxOrQuery)
      ? { bbox: bboxOrQuery as GeoBbox2D }
      : bboxOrQuery;
    const entityTypes = query.entityTypes?.map(encodedEntityType);
    const requestedLayerMask = queryLayerMask(query.layers);
    const positions = this.spatialIndex
      .search(...query.bbox, (position) => {
        if (entityTypes && !entityTypes.includes(this.entityTypes[position] as EncodedEntityType)) {
          return false;
        }
        if (
          query.geometryMask !== undefined &&
          (this.geometryMasks[position]! & query.geometryMask) === 0
        ) {
          return false;
        }
        return (
          requestedLayerMask === undefined ||
          (this.layerMasks[position]! & requestedLayerMask) !== 0
        );
      })
      .sort((a, b) => a - b);
    return positions.map((position) => this.record(position));
  }

  /** Query one entity kind without materializing records rejected by the caller's filter. */
  queryEntityIndexes(
    bbox: GeoBbox2D,
    entityType: ShortbreadFeatureEntityType,
    include: (entityIndex: number) => boolean = () => true,
  ): number[] {
    if (!this.spatialIndex) return [];
    const encodedType = encodedEntityType(entityType);
    return this.spatialIndex
      .search(...bbox, (position) => {
        const entityIndex = this.entityIndexes[position]!;
        return this.entityTypes[position] === encodedType && include(entityIndex);
      })
      .sort((a, b) => a - b)
      .map((position) => this.entityIndexes[position]!);
  }

  /** Return the Shortbread layers supplied by classified area relations for this member way. */
  suppressedLayerMaskForWay(id: number): number {
    let low = 0;
    let high = this.suppressedAreaWayIds.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const candidate = this.suppressedAreaWayIds[middle]!;
      if (candidate === id) return this.suppressedAreaWayLayerMasks[middle] ?? 0;
      if (candidate < id) low = middle + 1;
      else high = middle - 1;
    }
    return 0;
  }

  /** Test whether a relation supplies all or one specific classified layer for a member way. */
  suppressesWay(id: number, layer?: ShortbreadLayerName): boolean {
    const mask = this.suppressedLayerMaskForWay(id);
    if (layer === undefined) return mask !== 0;
    const bit = layerBits.get(layer);
    return bit !== undefined && (mask & bit) !== 0;
  }

  transferables(): ShortbreadFeatureIndexTransferables {
    return {
      bboxes: this.bboxes.buffer,
      entityIndexes: this.entityIndexes.buffer,
      entityTypes: this.entityTypes.buffer,
      geometryMasks: this.geometryMasks.buffer,
      layerMasks: this.layerMasks.buffer,
      ...(this.spatialIndex ? { spatialIndex: this.spatialIndex.data as BufferType } : {}),
      suppressedAreaWayIds: this.suppressedAreaWayIds.buffer,
      suppressedAreaWayLayerMasks: this.suppressedAreaWayLayerMasks.buffer,
    };
  }

  backingBuffers(): BufferType[] {
    return getShortbreadFeatureIndexBuffers(this.transferables());
  }

  private record(position: number): ShortbreadFeatureRecord {
    const offset = position * 4;
    return {
      entityIndex: this.entityIndexes[position]!,
      entityType: entityTypeName(this.entityTypes[position]! as EncodedEntityType),
      geometryMask: this.geometryMasks[position]!,
      layerMask: this.layerMasks[position]!,
      bbox: [
        this.bboxes[offset]!,
        this.bboxes[offset + 1]!,
        this.bboxes[offset + 2]!,
        this.bboxes[offset + 3]!,
      ],
    };
  }
}

/** Test whether a compact feature record was classified into a layer. */
export function shortbreadFeatureHasLayer(
  record: Pick<ShortbreadFeatureRecord, "layerMask">,
  layer: ShortbreadLayerName,
): boolean {
  const bit = layerBits.get(layer);
  return bit !== undefined && (record.layerMask & bit) !== 0;
}
