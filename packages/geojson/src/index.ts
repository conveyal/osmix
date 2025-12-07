/**
 * @osmix/geojson - Convert between OSM entities and GeoJSON.
 *
 * Provides bidirectional conversion between Osmix data structures and GeoJSON:
 * - **Export**: Convert OSM nodes, ways, and relations to GeoJSON Features.
 * - **Import**: Build an Osm index from a GeoJSON FeatureCollection.
 *
 * Handles geometry mapping:
 * - Nodes → Point
 * - Ways → LineString or Polygon (based on tags and closure)
 * - Relations → MultiPolygon, MultiLineString, or GeometryCollection (by type)
 *
 * @example
 * ```ts
 * // Export OSM entity to GeoJSON
 * import { nodeToFeature, wayToFeature } from "@osmix/geojson"
 *
 * const pointFeature = nodeToFeature(node)
 * const lineFeature = wayToFeature(way, (ref) => osm.nodes.getNodeLonLat({ id: ref }))
 * ```
 *
 * @example
 * ```ts
 * // Import GeoJSON to Osm index
 * import { fromGeoJSON } from "@osmix/geojson"
 *
 * const osm = await fromGeoJSON(geojsonFile, { id: "imported" })
 * ```
 *
 * @module @osmix/geojson
 */

export * from "./entity-to-feature"
export * from "./osm-from-geojson"
export * from "./types"
