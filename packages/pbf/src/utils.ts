export type AsyncGeneratorValue<T> =
	| T
	| ReadableStream<T>
	| AsyncGenerator<T>
	| Promise<T>
	| Promise<ReadableStream<T>>
	| Promise<AsyncGenerator<T>>

/**
 * Convert a value or a stream to an async generator.
 */
export async function* toAsyncGenerator<T>(
	v: AsyncGeneratorValue<T>,
): AsyncGenerator<T> {
	if (v instanceof Promise) return toAsyncGenerator(await v)

	if (v == null) throw Error("Value is null")
	if (v instanceof ReadableStream) {
		const reader = v.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			yield value
		}
		reader.releaseLock()
	} else if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) {
		// Treat ArrayBuffer and TypedArrays (like Uint8Array, Buffer) as single values
		yield v as T
	} else if (
		typeof v === "object" &&
		(Symbol.asyncIterator in v || Symbol.iterator in v)
	) {
		return v
	} else {
		yield v
	}
}

/**
 * Check if we're in Bun runtime.
 */
function isBun(): boolean {
	return typeof Bun !== "undefined"
}

/**
 * Async decompress data via a decompression stream.
 * Detects Bun runtime and uses Node.js zlib module for compatibility with OSM PBF format.
 */
export async function decompress(
	data: BlobPart,
	format: CompressionFormat = "deflate",
): Promise<Uint8Array> {
	// Check if we're in Bun runtime - use Node.js zlib for proper OSM PBF zlib format support
	if (isBun()) {
		const { inflateSync, gunzipSync, inflateRawSync } = await import(
			"node:zlib"
		)
		const bytes =
			data instanceof Uint8Array
				? data
				: new Uint8Array(await new Blob([data]).arrayBuffer())

		switch (format) {
			case "deflate":
				// OSM PBF uses zlib format (deflate with headers)
				return new Uint8Array(inflateSync(bytes))
			case "gzip":
				return new Uint8Array(gunzipSync(bytes))
			case "deflate-raw":
				return new Uint8Array(inflateRawSync(bytes))
			default:
				throw new Error(`Unsupported compression format in Bun: ${format}`)
		}
	}

	// Fallback to standard Web API
	const decompressedStream = new Blob([data])
		.stream()
		.pipeThrough(new DecompressionStream(format))
	return new Response(decompressedStream).bytes()
}

/**
 * Compress data using the native browser/runtime compression stream.
 * Detects Bun runtime and uses Node.js zlib module for compatibility with OSM PBF format.
 */
export async function compress(
	data: BlobPart,
	format: CompressionFormat = "deflate",
): Promise<Uint8Array<ArrayBuffer>> {
	// Check if we're in Bun runtime - use Node.js zlib for proper OSM PBF zlib format support
	if (isBun()) {
		const { deflateSync, gzipSync, deflateRawSync } = await import("node:zlib")
		const bytes =
			data instanceof Uint8Array
				? data
				: new Uint8Array(await new Blob([data]).arrayBuffer())

		switch (format) {
			case "deflate":
				// OSM PBF uses zlib format (deflate with headers)
				return new Uint8Array(deflateSync(bytes))
			case "gzip":
				return new Uint8Array(gzipSync(bytes))
			case "deflate-raw":
				return new Uint8Array(deflateRawSync(bytes))
			default:
				throw new Error(`Unsupported compression format in Bun: ${format}`)
		}
	}

	// Fallback to standard Web API
	const stream = new CompressionStream(format)
	const compressedStream = new Blob([data]).stream().pipeThrough(stream)
	return new Response(compressedStream).bytes()
}

/**
 * Concatenate Uint8Arrays.
 */
export function concatUint8(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((n, p) => n + p.length, 0)
	const out = new Uint8Array(total)
	let offset = 0
	for (const p of parts) {
		out.set(p, offset)
		offset += p.length
	}
	return out
}

/**
 * Encode a 32-bit *big-endian* unsigned integer.
 */
export function uint32BE(n: number): Uint8Array {
	const out = new Uint8Array(4)
	out[0] = (n >>> 24) & 0xff
	out[1] = (n >>> 16) & 0xff
	out[2] = (n >>> 8) & 0xff
	out[3] = n & 0xff
	return out
}
