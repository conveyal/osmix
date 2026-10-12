/**
 * Every query the bench runs, with the definition both engines must meet and a description
 * of how each engine answers it. The UI renders these descriptions next to the results.
 */

import { pointToTileFraction, tileToBbox } from "@osmix/geo/tile";
import type { GeoBbox2D, Tile } from "@osmix/types";

import type { QuerySpec } from "./engines/types";

export interface Operation {
  id: string;
  title: string;
  /** The precise meaning both engines implement. */
  meaning: string;
  /** How Osmix answers it. */
  osmix: string;
  /** How DuckDB answers it, in words. The UI also shows the exact SQL. */
  duckdb: string;
  /** Tradeoffs a reader should know when reading the timing. */
  notes?: string;
  spec: QuerySpec;
}

/** Zoom of the benchmark vector tile: street level, where tiles are dense. */
const TILE_ZOOM = 14;
const NEAREST_COUNT = 5;
const TAG_KEY = "highway";

/** Square bboxes centered on the dataset, sized as a share of its shorter side. */
export function testGeometry(bbox: GeoBbox2D) {
  const centerLon = (bbox[0] + bbox[2]) / 2;
  const centerLat = (bbox[1] + bbox[3]) / 2;
  const side = Math.min(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const square = (share: number): GeoBbox2D => {
    const half = (side * share) / 2;
    return [centerLon - half, centerLat - half, centerLon + half, centerLat + half];
  };
  const [fx, fy] = pointToTileFraction(centerLon, centerLat, TILE_ZOOM);
  const tile: Tile = [Math.floor(fx), Math.floor(fy), TILE_ZOOM];
  return {
    centerLon,
    centerLat,
    bboxes: { small: square(0.01), medium: square(0.1), large: square(0.5) },
    tile,
    tileBbox: tileToBbox(tile),
  };
}

const SIZES = [
  ["small", "1%"],
  ["medium", "10%"],
  ["large", "50%"],
] as const;

export function buildOperations(bbox: GeoBbox2D): Operation[] {
  const geometry = testGeometry(bbox);
  const operations: Operation[] = [];

  for (const [size, share] of SIZES) {
    operations.push({
      id: `bbox-nodes-${size}`,
      title: `Bbox nodes (${size})`,
      meaning: `IDs of all nodes inside a square bbox, edges included. The square's side is ${share} of the dataset's shorter side.`,
      osmix: "KD-tree range search over every node (`nodes.findIndexesWithinBbox`).",
      duckdb:
        "`ST_Intersects` against an envelope. The planner uses the RTREE when it expects the filter to keep few rows.",
      spec: { kind: "bbox-nodes", bbox: geometry.bboxes[size] },
    });
  }

  for (const [size, share] of SIZES) {
    operations.push({
      id: `bbox-ways-candidates-${size}`,
      title: `Bbox way candidates (${size})`,
      meaning: `IDs of ways whose bounding box intersects the square (side ${share} of the dataset). This is an index lookup with no exact geometry test.`,
      osmix: "Flatbush search over precomputed way bboxes (`ways.intersects`).",
      duckdb:
        "The `&&` bbox operator, which the RTREE can answer. `ST_Intersects_Extent` means the same but never uses the index.",
      spec: { kind: "bbox-way-candidates", bbox: geometry.bboxes[size] },
    });
  }

  for (const [size, share] of SIZES) {
    operations.push({
      id: `bbox-ways-exact-${size}`,
      title: `Bbox ways, exact (${size})`,
      meaning: `IDs of ways whose line touches the square (side ${share} of the dataset). Closed ways count as lines, not areas.`,
      osmix:
        "Flatbush candidates, then a line-clip test for ways that are not fully inside the square.",
      duckdb: "`ST_Intersects` on the stored LINESTRING, with the RTREE as a prefilter.",
      spec: { kind: "bbox-ways-exact", bbox: geometry.bboxes[size] },
    });
  }

  operations.push({
    id: "knn",
    title: `${NEAREST_COUNT} nearest nodes`,
    meaning: `IDs of the ${NEAREST_COUNT} nodes closest to the dataset center by haversine distance, ties broken by lower ID.`,
    osmix:
      "KD-tree radius search starting at 250 m and widening 4× until it holds enough nodes, then a haversine sort.",
    duckdb:
      "The same widening search: an RTREE `&&` prefilter around the radius, then `ORDER BY ST_Distance_Sphere(...) LIMIT 5`. The SQL below is the first step; JavaScript reruns it with a 4× radius until the 5th node is inside the radius.",
    notes:
      "DuckDB's RTREE only answers filter predicates, not nearest-neighbor queries, so a single statement must scan every node. That plain `ORDER BY ... LIMIT 5` takes about 630 ms on a 2.7M-node extract.",
    spec: { kind: "knn", lon: geometry.centerLon, lat: geometry.centerLat, k: NEAREST_COUNT },
  });

  operations.push({
    id: "tag-filter",
    title: `Ways with ${TAG_KEY}=*`,
    meaning: `IDs of all ways that have a \`${TAG_KEY}\` tag, whatever its value.`,
    osmix: "Reverse tag-key index built at load (`tags.hasKey`).",
    duckdb: "`map_contains` over the tags MAP column, a vectorized scan.",
    spec: { kind: "tag-filter", key: TAG_KEY },
  });

  operations.push({
    id: "tag-aggregate",
    title: `Count ways by ${TAG_KEY} value`,
    meaning: `For each \`${TAG_KEY}\` value, the number of ways with it.`,
    osmix:
      "Reverse tag-key index, then a JavaScript Map count that reads each way's tags through `tags.getTags`.",
    duckdb: "`GROUP BY tags['highway']`, DuckDB's vectorized hash aggregate.",
    notes:
      "Grouping and aggregation are what columnar SQL engines are built for. Osmix has no query planner or aggregate operators; this row shows what that costs.",
    spec: { kind: "tag-aggregate", key: TAG_KEY },
  });

  operations.push({
    id: "geojson",
    title: "GeoJSON export",
    meaning:
      "One FeatureCollection string: tagged nodes as Points and every way with 2 or more coordinates as a LineString, with tags as properties.",
    osmix: "Walk tagged nodes and all ways, then `JSON.stringify` each feature in the worker.",
    duckdb:
      "`json_object` and `ST_AsGeoJSON`, one feature per row. JavaScript joins the rows into one string.",
    notes:
      "Osmix's own `wayToFeature` also makes Polygons for area ways and can build multipolygons from relations. `ST_ReadOSM` has no area rules, so both sides emit lines here.",
    spec: { kind: "geojson" },
  });

  const [x, y, z] = geometry.tile;
  operations.push({
    id: "tile",
    title: `Vector tile ${z}/${x}/${y}`,
    meaning:
      "A Mapbox Vector Tile of the tile at the dataset center with two layers: tagged nodes, and tagged ways as lines clipped to the tile plus a 64-unit buffer. Features carry their OSM ID and no tags.",
    osmix:
      "Tagged-node KD search and way Flatbush search, projection to tile pixels, line clipping, then `writeVtPbf` from `@osmix/vt`.",
    duckdb:
      "`ST_Transform` to Web Mercator, `ST_AsMVTGeom`, and `ST_AsMVT` for each layer, with the two layers joined into one blob.",
    notes:
      "`ST_AsMVT` only accepts 32-bit feature IDs, and OSM IDs are larger, so DuckDB writes the ID as an `osm_id` property. Osmix writes it as the MVT feature ID, zigzag-encoded so the negative IDs of unsaved entities survive. Production `OsmixVtEncoder` tiles also carry tags, area polygons, and relation geometry. The bench leaves those out so both sides do the same work.",
    spec: { kind: "tile", tile: geometry.tile, bbox: geometry.tileBbox },
  });

  return operations;
}
