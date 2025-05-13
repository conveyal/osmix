export function nativeDecompress(data: Uint8Array) {
	const stream = new DecompressionStream("deflate")
	const decompressedStream = new Blob([data]).stream().pipeThrough(stream)
	return new Response(decompressedStream).arrayBuffer()
}

export function nativeCompress(data: ArrayBuffer) {
	const stream = new CompressionStream("deflate")
	const compressedStream = new Blob([data]).stream().pipeThrough(stream)
	return new Response(compressedStream).arrayBuffer()
}

export function assertNonNull(
	o: unknown,
	message?: string,
): asserts o is NonNullable<typeof o> {
	if (o == null) {
		throw new Error(message || "Expected non-null value")
	}
}

export function getString(table: string[], keys: number[], index: number) {
	const key = keys[index]
	if (key === undefined) return undefined
	return table[key]
}

export function getTags(
	table: string[],
	keys: number[],
	vals: number[],
): Record<string, string> {
	return Object.fromEntries(
		keys
			.map((_, i) => [getString(table, keys, i), getString(table, vals, i)])
			.filter(([key, val]) => key && val),
	)
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
