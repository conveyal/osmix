/**
 * Type definitions for Shapefile import.
 * @module
 */

import type { FeatureCollection } from "geojson"

/**
 * Input types accepted by `fromShapefile`.
 *
 * Supports multiple formats:
 * - `ArrayBufferLike` - Binary ZIP data containing shapefile components
 * - `ReadableStream` - Stream of ZIP data (will be consumed to ArrayBuffer)
 * - `string` - URL to a shapefile or ZIP file
 */
export type ReadShapefileDataTypes = ArrayBufferLike | ReadableStream | string

/**
 * Result from shpjs parsing.
 * Can be a single FeatureCollection or an array if the ZIP contains multiple shapefiles.
 */
export type ShpjsResult =
	| (FeatureCollection & { fileName?: string })
	| (FeatureCollection & { fileName?: string })[]
