/**
 * @osmix/core - In-memory OSM entity storage with spatial indexing.
 *
 * Efficiently stores and queries OpenStreetMap entities (nodes, ways, relations).
 *
 * Features:
 * - **Memory-efficient**: Uses typed arrays; coordinates are Int32 at 1e-7 degrees.
 * - **Spatial indexing**: Compact indirect KD trees (points) and Flatbush (bboxes).
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
/// <reference path="./types/geoflatbush.d.ts" />

export type { IdOrIndex } from "./ids.ts";
export type { OsmReader, OsmWriter } from "./contracts.ts";
export { OsmEntityIndexBuildError, type OsmEntityIndexComponent } from "./entities.ts";
export * from "./limits.ts";
export * from "./nodes.ts";
export * from "./osm.ts";
export * from "./relations.ts";
export { negativeIdMap, renumberNegativeIds, type OsmIdMap } from "./renumber.ts";
export * from "./stringtable.ts";
export * from "./tags.ts";
export {
  BufferConstructor,
  TypedBufferAllocationError,
  type BufferType,
  type TypedBufferAllocationOperation,
  type TypedBufferType,
} from "./typed-arrays.ts";
export * from "./ways.ts";
