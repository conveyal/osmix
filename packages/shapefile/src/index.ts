/**
 * @osmix/shapefile - Import Shapefiles into Osmix indexes.
 *
 * Provides Shapefile import functionality for Osmix:
 * - **Import**: Build an Osm index from Shapefile data (ZIP archive).
 *
 * Handles geometry mapping:
 * - Point → Node
 * - Polyline → Way (LineString)
 * - Polygon → Way or Relation (based on ring count)
 * - MultiPoint → Multiple Nodes
 *
 * @example
 * ```ts
 * // Import Shapefile to Osm index
 * import { fromShapefile } from "@osmix/shapefile"
 *
 * const zipBuffer = await Bun.file('./buildings.zip').arrayBuffer()
 * const osm = await fromShapefile(zipBuffer, { id: "buildings" })
 *
 * // Query the imported data
 * const buildings = osm.ways.search("building")
 * ```
 *
 * @module @osmix/shapefile
 */

export * from "./osm-from-shapefile"
export * from "./types"
