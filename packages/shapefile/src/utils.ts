/// <reference path="./shpjs.d.ts" />
/**
 * Utility functions for Shapefile data handling.
 * @module
 */

import type { FeatureCollection } from "geojson"
import shp from "shpjs"
import type { ReadShapefileDataTypes, ShpjsResult } from "./types"

/**
 * Parse Shapefile data and return GeoJSON FeatureCollection(s).
 *
 * Uses shpjs to parse Shapefiles and automatically project to WGS84.
 *
 * @param data - Shapefile data (URL string, ArrayBuffer/ReadableStream of ZIP).
 * @returns Array of GeoJSON FeatureCollections with optional fileName.
 * @throws If data is null or parsing fails.
 *
 * @example
 * ```ts
 * // From ArrayBuffer
 * const collections = await parseShapefile(zipBuffer)
 *
 * // From URL
 * const collections = await parseShapefile('https://example.com/data.zip')
 * ```
 */
export async function parseShapefile(
	data: ReadShapefileDataTypes,
): Promise<(FeatureCollection & { fileName?: string })[]> {
	if (data == null) throw new Error("Data is null")

	let input: ArrayBufferLike | string

	// Convert ReadableStream to ArrayBuffer
	if (data instanceof ReadableStream) {
		input = await streamToArrayBuffer(data)
	} else if (data instanceof SharedArrayBuffer) {
		// shpjs expects ArrayBuffer, not SharedArrayBuffer
		const copy = new ArrayBuffer(data.byteLength)
		new Uint8Array(copy).set(new Uint8Array(data))
		input = copy
	} else {
		input = data
	}

	const result: ShpjsResult = await shp(input)

	// Normalize to array
	if (Array.isArray(result)) {
		return result
	}
	return [result]
}

/**
 * Convert a ReadableStream to an ArrayBuffer.
 */
async function streamToArrayBuffer(
	stream: ReadableStream,
): Promise<ArrayBuffer> {
	const reader = stream.getReader()
	const chunks: Uint8Array[] = []
	let totalLength = 0

	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		chunks.push(value)
		totalLength += value.byteLength
	}

	const result = new Uint8Array(totalLength)
	let offset = 0
	for (const chunk of chunks) {
		result.set(chunk, offset)
		offset += chunk.byteLength
	}

	return result.buffer
}
