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

// oxlint-disable-next-line typescript/triple-slash-reference -- ambient module declarations for untyped packages
/// <reference path="./types/kdbush.d.ts" />
// oxlint-disable-next-line typescript/triple-slash-reference -- ambient module declarations for untyped packages
/// <reference path="./types/geokdbush.d.ts" />
// oxlint-disable-next-line typescript/triple-slash-reference -- ambient module declarations for untyped packages
/// <reference path="./types/geoflatbush.d.ts" />

export type { IdOrIndex } from "./ids.ts";
export type { OsmReader, OsmWriter } from "./contracts.ts";
export * from "./nodes.ts";
export * from "./osm.ts";
export * from "./relations.ts";
export * from "./stringtable.ts";
export * from "./tags.ts";
export { BufferConstructor, type BufferType } from "./typed-arrays.ts";
export * from "./ways.ts";
