/**
 * @osmix/json - Convert OSM PBF to/from JSON entities.
 *
 * Streaming transforms for converting between raw OSM PBF bytes and ergonomic
 * JSON structures (nodes, ways, relations with decoded tags and coordinates).
 *
 * Key capabilities:
 * - **Decode**: Stream `.osm.pbf` bytes into typed JSON entities with resolved string tables.
 * - **Encode**: Convert JSON entities back to spec-compliant PBF blobs with delta encoding.
 * - **Compose**: Chain with `@osmix/pbf` streams for complete PBF round-trips.
 *
 * @example
 * ```ts
 * // Decode PBF to JSON entities
 * import { osmPbfToJson } from "@osmix/json"
 * import { toAsyncGenerator } from "@osmix/pbf"
 *
 * const stream = osmPbfToJson(Bun.file('./monaco.pbf').stream())
 * for await (const item of toAsyncGenerator(stream)) {
 *   if ("id" in item) {
 *     console.log(item.type, item.id, item.tags?.name)
 *   }
 * }
 * ```
 *
 * @example
 * ```ts
 * // Encode JSON entities to PBF
 * import { osmJsonToPbf } from "@osmix/json"
 *
 * const header = { required_features: ["DenseNodes"], optional_features: [] }
 * const pbfStream = osmJsonToPbf(header, entitiesGenerator)
 * ```
 *
 * @module @osmix/json
 */

export * from "./constants"
export * from "./json-to-pbf"
export * from "./osm-pbf-block-builder"
export * from "./osm-pbf-block-parser"
export * from "./pbf-to-json"
