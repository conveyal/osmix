/**
 * The SQL the DuckDB engine runs. The UI shows these exact strings next to each result, so
 * this module is the single source for both.
 */

import type { GeoBbox2D } from "@osmix/types";

import {
  NEAREST_MAX_RADIUS_M,
  NEAREST_START_RADIUS_M,
  type QuerySpec,
  TILE_BUFFER,
  TILE_EXTENT,
} from "./types";

export interface LoadStatement {
  phase: string;
  sql: string;
}

/**
 * Statements that turn a PBF into indexed tables. `ST_ReadOSM` returns one wide row per
 * entity; the bench normalizes it into point and line tables with RTREE indexes, which is
 * how the DuckDB spatial docs recommend querying geometry.
 */
export function loadStatements(path: string): LoadStatement[] {
  return [
    {
      phase: "Read PBF (ST_ReadOSM)",
      sql: `CREATE TABLE raw AS SELECT * FROM ST_ReadOSM('${path}')`,
    },
    {
      phase: "Build node points",
      sql: `CREATE TABLE nodes AS
SELECT id, tags, ST_Point(lon, lat) AS geom
FROM raw
WHERE kind = 'node'`,
    },
    {
      // Tags stay out of this GROUP BY: carrying the MAP column through the aggregate runs
      // duckdb-wasm out of memory on a 30 MB extract.
      phase: "Build way lines",
      sql: `CREATE TABLE way_lines AS
SELECT w.id, ST_MakeLine(list(n.geom ORDER BY r.pos)) AS geom
FROM (SELECT id, refs FROM raw WHERE kind = 'way') AS w
CROSS JOIN UNNEST(w.refs) WITH ORDINALITY AS r(ref, pos)
JOIN nodes AS n ON n.id = r.ref
GROUP BY w.id
HAVING count(*) >= 2`,
    },
    {
      phase: "Attach way tags",
      sql: `CREATE TABLE ways AS
SELECT w.id, w.tags, l.geom
FROM raw AS w
LEFT JOIN way_lines AS l USING (id)
WHERE w.kind = 'way'`,
    },
    {
      phase: "Drop temporary tables",
      sql: "DROP TABLE raw; DROP TABLE way_lines",
    },
    {
      phase: "Build RTREE indexes",
      sql: `CREATE INDEX nodes_rtree ON nodes USING RTREE (geom);
CREATE INDEX ways_rtree ON ways USING RTREE (geom)`,
    },
  ];
}

/** Row counts and node extent, read after the timed load. */
export const SUMMARY_SQL = `SELECT
  (SELECT count(*) FROM nodes) AS nodes,
  (SELECT count(*) FROM ways) AS ways,
  min(ST_X(geom)) AS min_lon, min(ST_Y(geom)) AS min_lat,
  max(ST_X(geom)) AS max_lon, max(ST_Y(geom)) AS max_lat
FROM nodes`;

function envelope([minLon, minLat, maxLon, maxLat]: GeoBbox2D) {
  return `ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat})`;
}

function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * One step of the nearest-node search: an RTREE bbox prefilter around a circle of
 * `radiusM` meters, then an exact haversine sort. The answer is final when it holds k
 * nodes and the farthest is within `radiusM`; otherwise the caller widens the radius.
 */
export function nearestSql(spec: Extract<QuerySpec, { kind: "knn" }>, radiusM: number) {
  // ST_Distance_Sphere expects [lat, lon] axis order.
  const distance = `ST_Distance_Sphere(ST_FlipCoordinates(geom), ST_Point(${spec.lat}, ${spec.lon}))`;
  const select = `SELECT id, ${distance} AS distance
FROM nodes`;
  const order = `ORDER BY distance, id
LIMIT ${spec.k}`;
  if (radiusM >= NEAREST_MAX_RADIUS_M) return `${select}\n${order}`;
  // A degree of latitude is at least 110.5 km; longitude degrees shrink with cos(lat).
  const dLat = radiusM / 110_000;
  const maxLat = Math.min(89.9, Math.abs(spec.lat) + dLat);
  const dLon = Math.min(180, dLat / Math.cos((maxLat * Math.PI) / 180));
  const bbox: GeoBbox2D = [spec.lon - dLon, spec.lat - dLat, spec.lon + dLon, spec.lat + dLat];
  return `${select}
WHERE geom && ${envelope(bbox)}
${order}`;
}

const TO_3857 = "ST_Transform(geom, 'EPSG:4326', 'EPSG:3857', always_xy := true)";

/** The SQL for one query. */
export function querySql(spec: QuerySpec): string {
  switch (spec.kind) {
    case "bbox-nodes":
      return `SELECT id FROM nodes
WHERE ST_Intersects(geom, ${envelope(spec.bbox)})`;
    case "bbox-way-candidates":
      return `SELECT id FROM ways
WHERE geom && ${envelope(spec.bbox)}`;
    case "bbox-ways-exact":
      return `SELECT id FROM ways
WHERE ST_Intersects(geom, ${envelope(spec.bbox)})`;
    case "knn":
      return nearestSql(spec, NEAREST_START_RADIUS_M);
    case "tag-filter":
      return `SELECT id FROM ways
WHERE map_contains(tags, ${quote(spec.key)})`;
    case "tag-aggregate":
      return `SELECT tags[${quote(spec.key)}] AS value, count(*) AS count
FROM ways
WHERE map_contains(tags, ${quote(spec.key)})
GROUP BY value`;
    case "geojson":
      // One feature per row; the caller joins them. Aggregating the whole collection with
      // string_agg runs duckdb-wasm out of memory on a 30 MB extract.
      return `SELECT json_object(
  'type', 'Feature', 'id', id, 'osm_type', 'node',
  'geometry', ST_AsGeoJSON(geom), 'properties', to_json(tags)
)::VARCHAR AS feature
FROM nodes
WHERE cardinality(tags) > 0
UNION ALL
SELECT json_object(
  'type', 'Feature', 'id', id, 'osm_type', 'way',
  'geometry', ST_AsGeoJSON(geom), 'properties', to_json(tags)
)::VARCHAR
FROM ways
WHERE geom IS NOT NULL`;
    case "tile": {
      const [x, y, z] = spec.tile;
      const bounds = `ST_Extent(ST_TileEnvelope(${z}, ${x}, ${y}))`;
      const mvtGeom = `ST_AsMVTGeom(${TO_3857}, ${bounds}, ${TILE_EXTENT}, ${TILE_BUFFER}, true)`;
      // ST_AsMVT feature ids must fit in an int32 and OSM ids do not, so the id is a property.
      const layer = (name: string) => `(
  SELECT ST_AsMVT({'osm_id': id, 'geom': geom}, '${name}', ${TILE_EXTENT}, 'geom')
  FROM (SELECT id, ${mvtGeom} AS geom FROM ${name}_in_tile)
  WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
)`;
      const env = envelope(spec.bbox);
      // MATERIALIZED keeps the RTREE scan. Inlined, the planner merges the spatial filter
      // with the ST_AsMVTGeom filters and scans every node instead.
      return `WITH nodes_in_tile AS MATERIALIZED (
  SELECT id, geom FROM nodes
  WHERE cardinality(tags) > 0 AND ST_Intersects(geom, ${env})
), ways_in_tile AS MATERIALIZED (
  SELECT id, geom FROM ways
  WHERE cardinality(tags) > 0 AND geom && ${env}
)
SELECT
  coalesce(${layer("nodes")}, ''::BLOB)
  || coalesce(${layer("ways")}, ''::BLOB) AS tile`;
    }
  }
}
