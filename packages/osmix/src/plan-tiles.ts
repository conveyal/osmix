/**
 * Vector tiles of a live merge plan: each imported feature drawn from the patch and coloured
 * by its current outcome. Tiles read outcomes when they are drawn, so they never go stale.
 */
import type { MergePlan } from "@osmix/change";
import type { Osm } from "@osmix/core";
import { bboxContainsOrIntersects } from "@osmix/geo/bbox-intersects";
import { tileToBbox } from "@osmix/geo/tile";
import type { Tile } from "@osmix/types";
import {
  clampTilePoint,
  clipTileLine,
  projectToTile,
  type VtSimpleFeature,
  writeVtPbf,
} from "@osmix/vt";

/** Tile layer names; each feature carries `featureKey` and `outcome` properties. */
export const PLAN_TILE_LAYERS = { ways: "ways", nodes: "nodes" } as const;

const EXTENT = 4096;

/** Maps a patch way or node index to the position of its plan feature, or -1. */
export interface PlanTileIndex {
  ways: Int32Array;
  nodes: Int32Array;
}

/**
 * Index the plan's way and node features by patch entity. A plan's feature list is fixed when
 * it is built (decisions only change outcomes), so one index serves the whole plan.
 */
export function planTileIndex(plan: MergePlan, patch: Osm): PlanTileIndex {
  const ways = new Int32Array(patch.ways.size).fill(-1);
  const nodes = new Int32Array(patch.nodes.size).fill(-1);
  plan.features.forEach((feature, position) => {
    if (feature.type === "way") {
      const index = patch.ways.ids.getIndexFromId(feature.originalId);
      if (index !== -1) ways[index] = position;
    } else if (feature.type === "node") {
      const index = patch.nodes.ids.getIndexFromId(feature.originalId);
      if (index !== -1) nodes[index] = position;
    }
  });
  return { ways, nodes };
}

/** One vector tile of the plan's imported ways and points. Relations are not drawn. */
export function planTile(
  plan: MergePlan,
  patch: Osm,
  index: PlanTileIndex,
  tile: Tile,
): ArrayBuffer {
  const bbox = tileToBbox(tile);
  const patchBbox = patch.bbox();
  if (patchBbox === null || !bboxContainsOrIntersects(bbox, patchBbox)) {
    return new ArrayBuffer(0);
  }
  const proj = projectToTile(tile, EXTENT);

  function* ways(): Generator<VtSimpleFeature> {
    for (const wayIndex of patch.ways.intersects(bbox)) {
      const position = index.ways[wayIndex] ?? -1;
      const feature = plan.features[position];
      if (!feature) continue;
      const geometry = clipTileLine(patch.ways.getCoordinates(wayIndex).map(proj), EXTENT);
      if (geometry.length === 0) continue;
      yield {
        id: position,
        type: 2,
        properties: { featureKey: feature.key, outcome: feature.outcome },
        geometry,
      };
    }
  }

  function* nodes(): Generator<VtSimpleFeature> {
    const nodeIndexes = patch.nodes.hasSpatialIndex("all")
      ? patch.nodes.findIndexesWithinBbox(bbox)
      : patch.nodes.findTaggedIndexesWithinBbox(bbox);
    for (const nodeIndex of nodeIndexes) {
      const position = index.nodes[nodeIndex] ?? -1;
      const feature = plan.features[position];
      if (!feature) continue;
      const point = clampTilePoint(proj(patch.nodes.getNodeLonLat({ index: nodeIndex })), EXTENT);
      yield {
        id: position,
        type: 1,
        properties: { featureKey: feature.key, outcome: feature.outcome },
        geometry: [[point]],
      };
    }
  }

  return writeVtPbf([
    { name: PLAN_TILE_LAYERS.ways, version: 2, extent: EXTENT, features: ways() },
    { name: PLAN_TILE_LAYERS.nodes, version: 2, extent: EXTENT, features: nodes() },
  ]);
}
