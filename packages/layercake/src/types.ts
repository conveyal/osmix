/**
 * Type definitions for GeoParquet data.
 *
 * @module
 */

import type { GeoBbox2D, OsmTags } from "@osmix/shared/types"
import type { AsyncBuffer, ParquetReadOptions } from "hyparquet"

/**
 * Source types that can be used to read GeoParquet data by hyparquet.
 * - string: File path (Node.js/Bun) or URL (browser)
 * - URL: URL object
 * - ArrayBuffer: Raw parquet data
 * - AsyncBuffer: hyparquet async buffer for streaming
 */
export type GeoParquetSource = string | URL | ArrayBuffer | AsyncBuffer

/**
 * Raw row from GeoParquet file.
 * The geometry field is WKB-encoded.
 */
export interface GeoParquetRow {
	/** OSM entity type */
	type: "node" | "way" | "relation"
	/** OSM entity ID */
	id: bigint | number
	/** OSM tags as string or key-value pairs */
	tags: OsmTags | string
	/** the xmin, ymin, xmax, and ymax of the element’s geometry */
	bbox: GeoBbox2D
	/** WKB-encoded geometry or GeoJSON */
	geometry: Uint8Array | GeoJSON.Geometry | string
}

/**
 * Options for reading GeoParquet files.
 */
export interface GeoParquetReadOptions
	extends Omit<ParquetReadOptions, "onComplete" | "file" | "columns"> {
	/** Column name for the entity type (default: "type") */
	typeColumn?: string
	/** Column name for the entity ID (default: "id") */
	idColumn?: string
	/** Column name for the entity tags (default: "tags") */
	tagsColumn?: string
	/** Column name for the entity bbox (default: "bbox") */
	bboxColumn?: string
	/** Column name for the entity geometry (default: "geometry") */
	geometryColumn?: string
}
