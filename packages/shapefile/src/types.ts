/**
 * Type definitions for Shapefile import.
 * @module
 */

import type { Shapefile } from "shapefile.js"

/**
 * Input types accepted by `fromShapefile`.
 *
 * Supports multiple formats:
 * - `ArrayBufferLike` - Binary ZIP data containing shapefile components
 * - `ReadableStream` - Streaming ZIP data
 * - `Record<string, Shapefile>` - Already-loaded Shapefile objects from shapefile.js
 */
export type ReadShapefileDataTypes =
	| ArrayBufferLike
	| ReadableStream
	| Record<string, Shapefile>
