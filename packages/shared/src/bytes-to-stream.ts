export function bytesToStream(bytes: Uint8Array) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes)
			controller.close()
		},
	})
}
