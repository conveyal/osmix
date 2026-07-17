import { wayIsArea } from "@osmix/geo/way-is-area";
import {
  SHORTBREAD_GEOMETRY_MASK,
  ShortbreadFeatureIndex,
  type ShortbreadFeatureEntityType,
  type ShortbreadGeometryType,
} from "@osmix/shortbread";
import type { GeoBbox2D, Osm } from "osmix";

import { resolveIndexedLabelMetadata, type MapLabelSpatialIndexProvider } from "./map-labels.ts";

const WORLD_BBOX: GeoBbox2D = [-180, -90, 180, 90];

function geometryType(mask: number): ShortbreadGeometryType | null {
  if ((mask & SHORTBREAD_GEOMETRY_MASK.POLYGON) !== 0) return "Polygon";
  if ((mask & SHORTBREAD_GEOMETRY_MASK.LINE_STRING) !== 0) return "LineString";
  if ((mask & SHORTBREAD_GEOMETRY_MASK.POINT) !== 0) return "Point";
  return null;
}

class ZoomedEntityLabelIndex implements MapLabelSpatialIndexProvider {
  private readonly index: EntityLabelIndex;
  private readonly zoom: number;

  constructor(index: EntityLabelIndex, zoom: number) {
    this.index = index;
    this.zoom = zoom;
  }

  intersects(bbox: GeoBbox2D): number[] {
    return this.index.intersects(bbox, this.zoom);
  }
}

class EntityLabelIndex {
  readonly size: number;
  private readonly entityType: ShortbreadFeatureEntityType;
  private readonly featureIndex: ShortbreadFeatureIndex;
  private readonly indexes: Uint32Array;
  private readonly minZooms: Uint8Array;

  private constructor(
    featureIndex: ShortbreadFeatureIndex,
    entityType: ShortbreadFeatureEntityType,
    indexes: Uint32Array,
    minZooms: Uint8Array,
  ) {
    this.featureIndex = featureIndex;
    this.entityType = entityType;
    this.indexes = indexes;
    this.minZooms = minZooms;
    this.size = indexes.length;
  }

  static buildWays(osm: Osm, featureIndex: ShortbreadFeatureIndex): EntityLabelIndex {
    const indexes: number[] = [];
    const minZooms: number[] = [];
    for (const entityIndex of featureIndex.queryEntityIndexes(WORLD_BBOX, "way")) {
      const way = osm.ways.getByIndex(entityIndex);
      if (!way.tags) continue;
      const metadata = resolveIndexedLabelMetadata(
        way.tags,
        wayIsArea(way) ? "Polygon" : "LineString",
      );
      if (!metadata) continue;
      indexes.push(entityIndex);
      minZooms.push(metadata.minZoom);
    }
    return new EntityLabelIndex(
      featureIndex,
      "way",
      Uint32Array.from(indexes),
      Uint8Array.from(minZooms),
    );
  }

  static buildRelations(osm: Osm, featureIndex: ShortbreadFeatureIndex): EntityLabelIndex {
    const indexes: number[] = [];
    const minZooms: number[] = [];
    for (const record of featureIndex.query(WORLD_BBOX)) {
      if (record.entityType !== "relation") continue;
      const tags = osm.relations.tags.getTags(record.entityIndex);
      const type = geometryType(record.geometryMask);
      if (!tags || !type) continue;
      const metadata = resolveIndexedLabelMetadata(tags, type);
      if (!metadata) continue;
      indexes.push(record.entityIndex);
      minZooms.push(metadata.minZoom);
    }
    return new EntityLabelIndex(
      featureIndex,
      "relation",
      Uint32Array.from(indexes),
      Uint8Array.from(minZooms),
    );
  }

  atZoom(zoom: number): MapLabelSpatialIndexProvider {
    return new ZoomedEntityLabelIndex(this, zoom);
  }

  intersects(bbox: GeoBbox2D, zoom: number): number[] {
    return this.featureIndex.queryEntityIndexes(bbox, this.entityType, (entityIndex) => {
      const position = this.position(entityIndex);
      return position >= 0 && zoom >= this.minZooms[position]!;
    });
  }

  private position(entityIndex: number): number {
    let low = 0;
    let high = this.indexes.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const candidate = this.indexes[middle]!;
      if (candidate === entityIndex) return middle;
      if (candidate < entityIndex) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }
}

/** Worker-owned CLI label metadata over the shared Shortbread feature index. */
export class SemanticLabelIndex {
  readonly relationCount: number;
  readonly wayCount: number;
  private readonly relations: EntityLabelIndex;
  private readonly ways: EntityLabelIndex;

  private constructor(relations: EntityLabelIndex, ways: EntityLabelIndex) {
    this.relations = relations;
    this.ways = ways;
    this.relationCount = relations.size;
    this.wayCount = ways.size;
  }

  static build(osm: Osm, featureIndex = ShortbreadFeatureIndex.build(osm)): SemanticLabelIndex {
    return new SemanticLabelIndex(
      EntityLabelIndex.buildRelations(osm, featureIndex),
      EntityLabelIndex.buildWays(osm, featureIndex),
    );
  }

  providers(zoom: number): {
    relations: MapLabelSpatialIndexProvider;
    ways: MapLabelSpatialIndexProvider;
  } {
    return { relations: this.relations.atZoom(zoom), ways: this.ways.atZoom(zoom) };
  }
}
