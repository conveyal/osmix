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
export function nativeCompress(data: Uint8Array) {
	const stream = new CompressionStream("deflate")
	const compressedStream = new Blob([data]).stream().pipeThrough(stream)
	return new Response(compressedStream).bytes()
}

/**
 * Decompress a zlib-compressed array of bytes.
 *
 * @param data - The compressed data.
 * @returns The decompressed array of bytes.
 */
export function nativeDecompress(data: Uint8Array) {
	const decompressedStream = new Blob([data])
		.stream()
		.pipeThrough(new DecompressionStream("deflate"))
	return new Response(decompressedStream).bytes()
}

/**
 * Convert a readable stream to an async iterator.
 */
export async function* streamToAsyncIterator<T>(stream: ReadableStream<T>) {
	// Get a lock on the stream
	const reader = stream.getReader()

	try {
		while (true) {
			// Read from the stream
			const { done, value } = await reader.read()
			// Exit if we're done
			if (done) return
			// Else yield the chunk
			yield value
		}
	} finally {
		reader.releaseLock()
	}
}
