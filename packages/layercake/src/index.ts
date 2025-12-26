/**
 * @osmix/layercake - Import OSM data from Layercake GeoParquet files.
 *
 * Provides import functionality for OpenStreetMap US Layercake GeoParquet files,
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
 * // Import Layercake data to Osm index
 * import { fromLayerCake } from "@osmix/layercake"
 *
 * const osm = await fromLayerCake("./data.parquet", { id: "layercake" })
 * osm.buildSpatialIndexes()
 * const highways = osm.ways.search("highway")
 * ```
 *
 * @module @osmix/layercake
 */

export * from "./from-layercake"
export * from "./types"
export { parseWkb } from "./wkb"
