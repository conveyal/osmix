import * as Comlink from "comlink"

export type Transferables = ArrayBufferLike | ReadableStream

/**
 * Collect all transferable values from a nested object. Usually to be transferred to or from a worker.
 */
export function collectTransferables(value: unknown): Transferables[] {
	const transferables: Transferables[] = []

	if (value instanceof ArrayBuffer) transferables.push(value)
	else if (value instanceof ReadableStream) transferables.push(value)
	else if (ArrayBuffer.isView(value)) transferables.push(value.buffer)
	else if (Array.isArray(value)) {
		for (const item of value) {
			transferables.push(...collectTransferables(item))
		}
	} else if (value && typeof value === "object") {
		for (const item of Object.values(value)) {
			transferables.push(...collectTransferables(item))
		}
	}

	return transferables
}

export function transfer<T>(data: T) {
	return Comlink.transfer(data, collectTransferables(data))
}

/**
 * Check if the browser supports transferable streams by trying to create an empty stream and sending it to a message channel.
 */
export function supportsReadableStreamTransfer(): boolean {
	// Require the basics first
	if (
		typeof ReadableStream === "undefined" ||
		typeof MessageChannel === "undefined"
	)
		return false

	const { port1 } = new MessageChannel()
	try {
		const rs = new ReadableStream() // empty is fine for feature test
		// If transferable streams are unsupported, this line throws a DataCloneError
		port1.postMessage(rs, [rs])
		return true
	} catch {
		return false
	} finally {
		port1.close()
	}
}

export const SUPPORTS_STREAM_TRANSFER = supportsReadableStreamTransfer()
export const SUPPORTS_SHARED_ARRAY_BUFFER =
	typeof SharedArrayBuffer !== "undefined"
