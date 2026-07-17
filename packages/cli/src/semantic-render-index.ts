import {
  type ShortbreadFeatureEntityType,
  ShortbreadFeatureIndex,
  type ShortbreadFeatureIndexTransferables,
} from "@osmix/shortbread";
import { BufferConstructor, type BufferType, type GeoBbox2D, type Osm } from "osmix";

import { potentialFeatureMinZoom } from "./map-style.ts";

const HIDDEN_ZOOM = 255;
const WORLD_BBOX: GeoBbox2D = [-180, -90, 180, 90];

export interface SemanticRenderIndexTransferables {
  featureIndex: ShortbreadFeatureIndexTransferables;
  relations: BufferType;
  ways: BufferType;
}

interface SpatialEntities {
  intersects(bbox: GeoBbox2D, filter?: (index: number) => boolean): number[];
}

export interface ZoomFilteredSpatialIndex {
  intersects(bbox: GeoBbox2D): number[];
}

function minimumZoom(tags: ReturnType<Osm["ways"]["tags"]["getTags"]>): number {
  if (!tags) return HIDDEN_ZOOM;
  let result = HIDDEN_ZOOM;
  for (const geometryType of ["Polygon", "LineString", "Point"] as const) {
    const candidate = potentialFeatureMinZoom(tags, geometryType);
    if (candidate !== null) result = Math.min(result, candidate);
  }
  return result;
}

function buildMinimumZooms(
  osm: Osm,
  featureIndex: ShortbreadFeatureIndex,
  entityType: "way" | "relation",
): Uint8Array {
  const entities = entityType === "way" ? osm.ways : osm.relations;
  const result = new Uint8Array(new BufferConstructor(entities.size));
  result.fill(HIDDEN_ZOOM);
  for (const entityIndex of featureIndex.queryEntityIndexes(WORLD_BBOX, entityType)) {
    result[entityIndex] = minimumZoom(entities.tags.getTags(entityIndex));
  }
  return result;
}

/** CLI minimum-zoom metadata over the shared Shortbread spatial candidate index. */
export class SemanticRenderIndex {
  readonly relationCount: number;
  readonly wayCount: number;
  private readonly featureIndex: ShortbreadFeatureIndex;
  private readonly relationMinimumZooms: Uint8Array;
  private readonly wayMinimumZooms: Uint8Array;

  private constructor(
    featureIndex: ShortbreadFeatureIndex,
    wayMinimumZooms: Uint8Array,
    relationMinimumZooms: Uint8Array,
  ) {
    this.featureIndex = featureIndex;
    this.wayMinimumZooms = wayMinimumZooms;
    this.relationMinimumZooms = relationMinimumZooms;
    this.wayCount = this.visibleCount(wayMinimumZooms);
    this.relationCount = this.visibleCount(relationMinimumZooms);
  }

  static build(osm: Osm, featureIndex = ShortbreadFeatureIndex.build(osm)): SemanticRenderIndex {
    return new SemanticRenderIndex(
      featureIndex,
      buildMinimumZooms(osm, featureIndex, "way"),
      buildMinimumZooms(osm, featureIndex, "relation"),
    );
  }

  static fromTransferables(
    transferables: SemanticRenderIndexTransferables,
    featureIndex = ShortbreadFeatureIndex.fromTransferables(transferables.featureIndex),
  ): SemanticRenderIndex {
    return new SemanticRenderIndex(
      featureIndex,
      new Uint8Array(transferables.ways),
      new Uint8Array(transferables.relations),
    );
  }

  relations(_entities: SpatialEntities, zoom: number): ZoomFilteredSpatialIndex {
    return this.provider("relation", this.relationMinimumZooms, zoom);
  }

  transferables(): SemanticRenderIndexTransferables {
    return {
      featureIndex: this.featureIndex.transferables(),
      ways: this.wayMinimumZooms.buffer as BufferType,
      relations: this.relationMinimumZooms.buffer as BufferType,
    };
  }

  ways(_entities: SpatialEntities, zoom: number): ZoomFilteredSpatialIndex {
    return this.provider("way", this.wayMinimumZooms, zoom);
  }

  private provider(
    entityType: ShortbreadFeatureEntityType,
    minimumZooms: Uint8Array,
    zoom: number,
  ): ZoomFilteredSpatialIndex {
    return {
      intersects: (bbox) =>
        this.featureIndex.queryEntityIndexes(
          bbox,
          entityType,
          (entityIndex) => minimumZooms[entityIndex]! <= zoom,
        ),
    };
  }

  private visibleCount(minimumZooms: Uint8Array): number {
    let count = 0;
    for (const minZoom of minimumZooms) if (minZoom !== HIDDEN_ZOOM) count++;
    return count;
  }
}
