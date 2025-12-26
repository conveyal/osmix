/**
 * Type definitions for Layercake GeoParquet data.
 *
 * @module
 */

import type { AsyncBuffer } from "hyparquet"

/**
 * Source types that can be used to read Layercake data.
 * - string: File path (Node.js/Bun) or URL (browser)
 * - URL: URL object
 * - ArrayBuffer: Raw parquet data
 * - AsyncBuffer: hyparquet async buffer for streaming
 */
export type LayerCakeSource = string | URL | ArrayBuffer | AsyncBuffer

/**
 * Raw row from a Layercake GeoParquet file.
 * The geometry field is WKB-encoded.
 */
export interface LayerCakeRow {
	/** OSM entity ID */
	id: bigint | number
	/** WKB-encoded geometry */
	geometry: Uint8Array
	/** OSM tags as key-value pairs */
	tags?: Record<string, string | number> | string | null
}

/**
 * Options for reading Layercake files.
 */
export interface LayerCakeReadOptions {
	/** Column name for the entity ID (default: "id") */
	idColumn?: string
	/** Column name for the geometry (default: "geometry") */
	geometryColumn?: string
	/** Column name for tags (default: "tags") */
	tagsColumn?: string
	/** Filter rows to specific entity types */
	entityTypes?: ("node" | "way" | "relation")[]
	/** Maximum number of rows to read (for testing/debugging) */
	maxRows?: number
}
