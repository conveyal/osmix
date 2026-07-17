import {
  ShortbreadFeatureIndex,
  type ShortbreadFeatureIndexTransferables,
} from "@osmix/shortbread";
import { BufferConstructor, type BufferType, type GeoBbox2D, type LonLat, type Osm } from "osmix";

import {
  resolveIndexedLabelMetadata,
  type IndexedMapLabelMetadata,
  type IndexedMapLabelNode,
} from "./map-labels.ts";
import { resolveFeatureStyles } from "./map-style.ts";

const WORLD_BBOX: GeoBbox2D = [-180, -90, 180, 90];

export interface SemanticNodeIndexTransferables {
  featureIndex: ShortbreadFeatureIndexTransferables;
  indexes: BufferType;
}

function sharedIndexes(values: number[]): Uint32Array {
  const result = new Uint32Array(
    new BufferConstructor(values.length * Uint32Array.BYTES_PER_ELEMENT),
  );
  result.set(values);
  return result;
}

/** CLI point-style and label metadata over the shared Shortbread spatial candidate index. */
export class SemanticNodeIndex {
  readonly labelCount: number;
  readonly size: number;

  private readonly featureIndex: ShortbreadFeatureIndex;
  private readonly ids: Float64Array;
  private readonly indexes: Uint32Array;
  private readonly labels: (IndexedMapLabelMetadata | null)[];
  private readonly lats: Float64Array;
  private readonly lons: Float64Array;

  private constructor(
    featureIndex: ShortbreadFeatureIndex,
    indexes: Uint32Array,
    ids: Float64Array,
    lons: Float64Array,
    lats: Float64Array,
    labels: (IndexedMapLabelMetadata | null)[],
  ) {
    this.featureIndex = featureIndex;
    this.indexes = indexes;
    this.ids = ids;
    this.lons = lons;
    this.lats = lats;
    this.labels = labels;
    this.size = indexes.length;
    this.labelCount = labels.reduce((count, label) => count + (label ? 1 : 0), 0);
  }

  static build(osm: Osm, featureIndex = ShortbreadFeatureIndex.build(osm)): SemanticNodeIndex {
    const indexes: number[] = [];
    const ids: number[] = [];
    const lons: number[] = [];
    const lats: number[] = [];
    const labels: (IndexedMapLabelMetadata | null)[] = [];
    for (const nodeIndex of featureIndex.queryEntityIndexes(WORLD_BBOX, "node")) {
      const tags = osm.nodes.tags.getTags(nodeIndex);
      if (!tags) continue;
      const label = resolveIndexedLabelMetadata(tags, "Point");
      const hasPointStyle = resolveFeatureStyles(tags, "Point", 20).some(
        (style) => style.kind === "point",
      );
      if (!label && !hasPointStyle) continue;

      const [lon, lat] = osm.nodes.getNodeLonLat({ index: nodeIndex });
      indexes.push(nodeIndex);
      ids.push(osm.nodes.ids.at(nodeIndex));
      lons.push(lon);
      lats.push(lat);
      labels.push(label);
    }

    return new SemanticNodeIndex(
      featureIndex,
      sharedIndexes(indexes),
      Float64Array.from(ids),
      Float64Array.from(lons),
      Float64Array.from(lats),
      labels,
    );
  }

  static fromTransferables(
    transferables: SemanticNodeIndexTransferables,
    featureIndex = ShortbreadFeatureIndex.fromTransferables(transferables.featureIndex),
  ): SemanticNodeIndex {
    return new SemanticNodeIndex(
      featureIndex,
      new Uint32Array(transferables.indexes),
      new Float64Array(0),
      new Float64Array(0),
      new Float64Array(0),
      [],
    );
  }

  /** Structurally implements the styled tile renderer's optional node provider. */
  findIndexesWithinBbox(bbox: GeoBbox2D): number[] {
    return this.featureIndex.queryEntityIndexes(
      bbox,
      "node",
      (entityIndex) => this.position(entityIndex) >= 0,
    );
  }

  transferables(): SemanticNodeIndexTransferables {
    return {
      featureIndex: this.featureIndex.transferables(),
      indexes: this.indexes.buffer as BufferType,
    };
  }

  /** Return only visible, zoom-eligible, already-classified label nodes. */
  findLabelNodes(bboxes: GeoBbox2D[], zoom: number): IndexedMapLabelNode[] {
    const visibleIndexes = new Set<number>();
    for (const bbox of bboxes) {
      for (const entityIndex of this.featureIndex.queryEntityIndexes(bbox, "node")) {
        visibleIndexes.add(entityIndex);
      }
    }

    const nodes: IndexedMapLabelNode[] = [];
    for (const entityIndex of [...visibleIndexes].sort((a, b) => a - b)) {
      const position = this.position(entityIndex);
      if (position < 0) continue;
      const metadata = this.labels[position];
      if (!metadata || zoom < metadata.minZoom) continue;
      nodes.push({
        coordinate: [this.lons[position]!, this.lats[position]!] satisfies LonLat,
        id: this.ids[position]!,
        metadata,
      });
    }
    return nodes;
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
