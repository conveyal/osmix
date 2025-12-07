/**
 * @osmix/pbf - Low-level OSM PBF parsing and serialization.
 *
 * Provides streaming primitives for reading and writing OpenStreetMap PBF files
 * using Web Streams and native compression APIs. Stays close to the official
 * protobuf schema (`osmformat.proto`, `fileformat.proto`) while exposing
 * predictable TypeScript types.
 *
 * Key capabilities:
 * - **Parse**: Read headers and primitive blocks from `ArrayBuffer`, async iterables, or `ReadableStream`.
 * - **Stream**: Use `TransformStream` helpers to process large files without buffering entirely in memory.
 * - **Serialize**: Write header and primitive blocks back to spec-compliant blobs with size guardrails.
 * - **Types**: Generated protobuf readers/writers and TypeScript interfaces for OSM data structures.
 *
 * @example
 * ```ts
 * import { readOsmPbf } from "@osmix/pbf"
 *
 * const { header, blocks } = await readOsmPbf(Bun.file('./monaco.pbf').stream())
 * console.log(header.required_features)
 *
 * for await (const block of blocks) {
 *   console.log(block.primitivegroup.length, "groups")
 * }
 * ```
 *
 * @module @osmix/pbf
 */

export * from "./blobs-to-blocks"
export * from "./blocks-to-pbf"
export * from "./pbf-to-blobs"
export * from "./pbf-to-blocks"
export * from "./proto/fileformat"
export * from "./proto/osmformat"
export * from "./spec"
export * from "./utils"
