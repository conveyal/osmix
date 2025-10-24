export function bytesToStream(bytes: Uint8Array<ArrayBuffer>) {
	return new ReadableStream<Uint8Array<ArrayBuffer>>({
		start(controller) {
			controller.enqueue(bytes)
			controller.close()
		},
	})
}
