import type { ImportableGeoJSON, ReadOsmDataTypes } from "./types"

/**
 * Read data as a GeoJSON FeatureCollection.
 * Supports string, ReadableStream, ArrayBufferLike, and GeoJSON FeatureCollection.
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
			result += value
			if (done) break
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
