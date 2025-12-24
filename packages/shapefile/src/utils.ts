/**
 * Utility functions for Shapefile data handling.
 * @module
 */

import { Shapefile } from "shapefile.js"
import type { ReadShapefileDataTypes } from "./types"

/**
 * Load Shapefile data from various input formats.
 *
 * Supports multiple input types for flexibility:
 * - **ReadableStream**: Streaming ZIP data
 * - **ArrayBuffer/SharedArrayBuffer**: Binary ZIP data to load
 * - **Record<string, Shapefile>**: Already-loaded Shapefile objects (passed through)
 *
 * @param data - Shapefile data in any supported format.
 * @returns Record of loaded Shapefile objects keyed by name.
 * @throws If data is null or an unsupported type.
 *
 * @example
 * ```ts
 * // From ArrayBuffer
 * const shapefiles = await loadShapefileData(zipBuffer)
 *
 * // From fetch response
 * const response = await fetch('/data.zip')
 * const shapefiles = await loadShapefileData(await response.arrayBuffer())
 * ```
 */
export async function loadShapefileData(
	data: ReadShapefileDataTypes,
): Promise<Record<string, Shapefile>> {
	if (data == null) throw new Error("Data is null")

	// Already-loaded Shapefile objects
	if (
		typeof data === "object" &&
		!("byteLength" in data) &&
		!("getReader" in data)
	) {
		// Check if this looks like a Record<string, Shapefile>
		const firstValue = Object.values(data)[0]
		if (firstValue && "parse" in firstValue && "contents" in firstValue) {
			return data as Record<string, Shapefile>
		}
	}

	// ArrayBuffer or SharedArrayBuffer
	if (data instanceof ArrayBuffer) {
		return Shapefile.load(data)
	}
	if (data instanceof SharedArrayBuffer) {
		// Convert SharedArrayBuffer to ArrayBuffer for shapefile.js
		const copy = new ArrayBuffer(data.byteLength)
		new Uint8Array(copy).set(new Uint8Array(data))
		return Shapefile.load(copy)
	}

	// ReadableStream - read all chunks into an ArrayBuffer
	if (data instanceof ReadableStream) {
		const reader = data.getReader()
		const chunks: Uint8Array[] = []
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (value) chunks.push(value)
		}
		// Combine chunks into a single ArrayBuffer
		const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
		const combined = new Uint8Array(totalLength)
		let offset = 0
		for (const chunk of chunks) {
			combined.set(chunk, offset)
			offset += chunk.length
		}
		return Shapefile.load(combined.buffer)
	}

	throw new Error(
		"Invalid data type. Accepts ArrayBufferLike, ReadableStream, or Record<string, Shapefile>.",
	)
}
