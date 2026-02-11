/**
 * Utility functions for GeoJSON data handling.
 * @module
 */

import type { ImportableGeoJSON, ReadOsmDataTypes } from "./types"

/**
 * Parse GeoJSON from various input formats.
 *
 * Supports multiple input types for flexibility:
 * - **string**: JSON string to parse
 * - **ReadableStream**: Streaming JSON data
 * - **ArrayBuffer/SharedArrayBuffer**: Binary data to decode and parse
 * - **Object**: Already-parsed FeatureCollection (passed through)
 *
 * @param data - GeoJSON data in any supported format.
 * @returns Parsed GeoJSON FeatureCollection.
 * @throws If data is null or an unsupported type.
 *
 * @example
 * ```ts
 * // From string
 * const geojson = await readDataAsGeoJSON('{"type":"FeatureCollection","features":[]}')
 *
 * // From fetch response
 * const response = await fetch('/data.geojson')
 * const geojson = await readDataAsGeoJSON(response.body!)
 * ```
 */
export async function readDataAsGeoJSON(
	data: ReadOsmDataTypes,
): Promise<ImportableGeoJSON> {
	if (data == null) throw new Error("Data is null")
	if (typeof data === "string") return JSON.parse(data) as ImportableGeoJSON

	if (data instanceof ReadableStream) {
		const reader = data.pipeThrough(new TextDecoderStream()).getReader()
		let result = ""
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (value !== undefined) result += value
		}
		return JSON.parse(result) as ImportableGeoJSON
	}
	if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) {
		const decoder = new TextDecoder()
		const text = decoder.decode(new Uint8Array(data))
		return JSON.parse(text) as ImportableGeoJSON
	}
	if (typeof data === "object" && "type" in data && "features" in data) {
		return data as ImportableGeoJSON
	}
	throw new Error(
		"Invalid data type. Accepts string, ReadableStream, ArrayBufferLike, or GeoJSON FeatureCollection.",
	)
}
