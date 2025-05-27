export function nativeCompress(data: Uint8Array) {
	const stream = new CompressionStream("deflate")
	const compressedStream = new Blob([data]).stream().pipeThrough(stream)
	return new Response(compressedStream).bytes()
}

export function assertNonNull(
	o: unknown,
	message?: string,
): asserts o is NonNullable<typeof o> {
	if (o == null) {
		throw new Error(message || "Expected non-null value")
	}
}

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
