/**
 * @osmix/core - In-memory OSM entity storage with spatial indexing.
 *
 * Efficiently stores and queries OpenStreetMap entities (nodes, ways, relations).
 *
 * Features:
 * - **Memory-efficient**: Uses typed arrays and Int32Array microdegrees.
 * - **Spatial indexing**: KDBush (points) and Flatbush (bboxes) for fast geographic queries.
 * - **Worker-ready**: Zero-copy transfer via `transferables()`.
 * - **Tag indexing**: Fast reverse lookup by tag key.
 *
 * @example
 * ```ts
 * import { Osm } from "@osmix/core"
 * const osm = new Osm({ id: "example" })
 * osm.nodes.addNode({ id: 1, lon: -122.4, lat: 47.6, tags: { name: "Seattle" } })
 * osm.buildIndexes()
 * osm.buildSpatialIndexes()
 * const nearby = osm.nodes.findIndexesWithinRadius(-122.4, 47.6, 10)
 * ```
 *
 * @module @osmix/core
 */

/// <reference path="./types/kdbush.d.ts" />
/// <reference path="./types/geokdbush.d.ts" />
/// <reference path="./types/geoflatbush.d.ts" />

export type { IdOrIndex } from "./ids"
export * from "./mocks"
export * from "./nodes"
export * from "./osm"
export * from "./relations"
export * from "./stringtable"
export * from "./tags"
export { BufferConstructor, type BufferType } from "./typed-arrays"
export * from "./ways"
