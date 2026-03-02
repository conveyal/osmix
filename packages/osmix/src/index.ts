/**
 * osmix - High-level entrypoint for the Osmix toolkit.
 *
 * This package provides a unified API for loading, manipulating, and exporting
 * OpenStreetMap data. It layers ingestion, streaming, and worker orchestration
 * on top of the lower-level @osmix/* packages.
 *
 * Key capabilities:
 * - **Loading**: Load PBF files and GeoJSON into memory-efficient Osm indexes.
 * - **Streaming**: Convert between PBF and JSON entity streams.
 * - **Extraction**: Create geographic extracts with various strategies.
 * - **Tiles**: Generate raster and vector tiles from OSM data.
 * - **Workers**: Offload heavy operations to Web Workers with `OsmixRemote`.
 * - **Merging**: Combine datasets with deduplication and intersection creation.
 *
 * @example
 * ```ts
 * import { fromPbf, toPbfBuffer, createExtract } from "osmix"
 *
 * // Load from PBF
 * const osm = await fromPbf(pbfFile.stream())
 *
 * // Create extract
 * const downtown = createExtract(osm, [-122.35, 47.60, -122.32, 47.62])
 *
 * // Export to PBF
 * const pbfBytes = await toPbfBuffer(downtown)
 * ```
 *
 * @example
 * ```ts
 * // Use workers for off-thread processing
 * import { createRemote } from "osmix"
 *
 * const remote = await createRemote()
 * const osm = await remote.fromPbf(pbfFile)
 * const tile = await osm.getVectorTile([9372, 12535, 15])
 * ```
 *
 * @module osmix
 */

// Re-export core libraries
export * from "@osmix/change"
export * from "@osmix/core"
export * from "@osmix/geojson"
export * from "@osmix/geoparquet"
export * from "@osmix/json"
export * from "@osmix/pbf"
export * from "@osmix/raster"
export * from "@osmix/router"
export * from "@osmix/shapefile"
export * from "@osmix/shared/types"
export * from "@osmix/vt"

// Export new utilities
export * from "./extract"
export * from "./pbf"
export * from "./raster"
export * from "./remote"
export * from "./settings"
export * from "./utils"
export * from "./worker"
