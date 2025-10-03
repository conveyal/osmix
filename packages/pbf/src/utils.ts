/**
 * Convert a value or a stream to an async generator.
 */
export async function* toAsyncGenerator<T>(
	v: T | ReadableStream<T> | AsyncGenerator<T>,
): AsyncGenerator<T> {
	if (v == null) throw Error("Value is null")
	if (v instanceof ReadableStream) {
		const reader = v.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			yield value
		}
		reader.releaseLock()
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
 * Async decompress data via a decompression stream.
 */
export function decompress(
	data: BlobPart,
	format: CompressionFormat = "deflate",
) {
	const decompressedStream = new Blob([data])
		.stream()
		.pipeThrough(new DecompressionStream(format))
	return new Response(decompressedStream).bytes()
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

/**
 * Compress data using the native browser/runtime compression stream.
 */
export function compress(
	data: BlobPart,
	format: CompressionFormat = "deflate",
) {
	const stream = new CompressionStream(format)
	const compressedStream = new Blob([data]).stream().pipeThrough(stream)
	return new Response(compressedStream).bytes()
}
