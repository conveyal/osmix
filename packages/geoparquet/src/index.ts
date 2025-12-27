/**
 * @osmix/geoparquet - Import OSM data from GeoParquet files.
 *
 * Provides import functionality for GeoParquet files including OpenStreetMap US Layercake,
 * converting geometry data to Osmix's in-memory format.
 *
 * Handles geometry mapping:
 * - Point → Node
 * - LineString → Way with nodes
 * - Polygon → Way (simple) or Relation (with holes)
 * - MultiPolygon → Multipolygon relation
 *
 * @example
 * ```ts
 * // Import GeoParquet data to Osm index
 * import { fromGeoParquet } from "@osmix/geoparquet"
 *
 * const osm = await fromGeoParquet("./data.parquet")
 * const highways = osm.ways.search("highway")
 * ```
 *
 * @module @osmix/geoparquet
 */

export * from "./from-geoparquet"
export * from "./types"
export { parseWkb } from "./wkb"
