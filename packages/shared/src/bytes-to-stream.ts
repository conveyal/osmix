/**
 * Byte array to stream conversion.
 *
 * Wraps a Uint8Array in a ReadableStream for use with streaming APIs.
 *
 * @module
 */

/**
 * Create a ReadableStream from a Uint8Array.
 *
 * The stream will emit the entire byte array as a single chunk,
 * then close immediately.
 *
 * @param bytes - The byte array to wrap.
 * @returns A ReadableStream that emits the bytes.
 */
export function bytesToStream(bytes: Uint8Array<ArrayBuffer>) {
	return new ReadableStream<Uint8Array<ArrayBuffer>>({
		start(controller) {
			controller.enqueue(bytes)
			controller.close()
		},
	})
}
