/**
 * @osmix/vt - Mapbox Vector Tile encoding for OSM data.
 *
 * Converts `@osmix/core` OSM datasets into Mapbox Vector Tiles (MVT) format.
 * Generates PBF-encoded tiles with separate layers for nodes, ways, and relations.
 *
 * Key features:
 * - **Per-entity layers**: Separate layers for nodes, ways, and relations.
 * - **Geometry conversion**: Ways become lines or polygons based on area heuristics.
 * - **Multipolygon support**: Renders multipolygon relations as proper polygons with holes.
 * - **Clipping**: Geometry is clipped to tile bounds with configurable buffer.
 * - **Winding order**: Automatically enforces MVT spec (CW outer, CCW inner rings).
 *
 * @example
 * ```ts
 * import { OsmixVtEncoder } from "@osmix/vt"
 *
 * const encoder = new OsmixVtEncoder(osm)
 * const pbfBuffer = encoder.getTile([9372, 12535, 15])
 *
 * // Use with MapLibre or other vector tile renderers
 * map.addSource("osmix", {
 *   type: "vector",
 *   tiles: [/* ... generate tile URLs ... *\/]
 * })
 * ```
 *
 * @module @osmix/vt
 */

export { OsmixVtEncoder, projectToTile } from "./encode"
export * from "./types"
export { default as writeVtPbf } from "./write-vt-pbf"
