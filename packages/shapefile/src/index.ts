/**
 * @osmix/shapefile - Import Shapefiles into Osmix indexes.
 *
 * Provides Shapefile import functionality for Osmix using shpjs:
 * - **Import**: Build an Osm index from Shapefile data (ZIP archive or URL).
 *
 * Shapefiles are first parsed to GeoJSON by shpjs (with automatic projection
 * to WGS84), then converted to OSM entities:
 * - Point/MultiPoint → Node(s)
 * - LineString/MultiLineString → Way(s)
 * - Polygon → Way or Relation (based on ring count)
 * - MultiPolygon → Relation
 *
 * @example
 * ```ts
 * // Import Shapefile to Osm index
 * import { fromShapefile } from "@osmix/shapefile"
 *
 * const zipBuffer = await Bun.file('./buildings.zip').arrayBuffer()
 * const osm = await fromShapefile(zipBuffer, { id: "buildings" })
 *
 * // Or from URL
 * const osm = await fromShapefile('https://example.com/data.zip')
 *
 * // Query the imported data
 * const buildings = osm.ways.search("building")
 * ```
 *
 * @module @osmix/shapefile
 */

export * from "./osm-from-shapefile"
export * from "./types"
