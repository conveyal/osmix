import * as Comlink from "comlink"
import type { OsmixWorker } from "./worker"

export type Transferables = ArrayBufferLike | ReadableStream

/**
 * Recursively collect all transferable values from a nested object.
 * Searches for ArrayBuffers, TypedArray buffers, and ReadableStreams.
 * Used to prepare data for zero-copy transfer to or from workers.
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

/**
 * Wrap data with Comlink.transfer, automatically collecting transferable buffers.
 * Enables zero-copy message passing for typed arrays and streams.
 */
export function transfer<T>(data: T) {
	return Comlink.transfer(data, collectTransferables(data))
}

/**
 * Feature-detect whether the browser supports transferable ReadableStreams.
 * Attempts to post a stream through a MessageChannel; throws DataCloneError if unsupported.
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

/**
 * The default number of workers to use.
 * If SharedArrayBuffer is supported, use the number of hardware concurrency.
 * Otherwise, use a single worker.
 */
export const DEFAULT_WORKER_COUNT = SUPPORTS_SHARED_ARRAY_BUFFER
	? (navigator.hardwareConcurrency ?? 1)
	: 1

/**
 * Expose a worker instance via Comlink.
 * Use this helper when creating custom worker entry points.
 *
 * @example
 * // my-custom.worker.ts
 * import { OsmixWorker, exposeWorker } from "osmix/worker"
 *
 * class MyCustomWorker extends OsmixWorker {
 *   myCustomMethod(id: string) {
 *     const osm = this.get(id)
 *     // ... custom logic
 *   }
 * }
 *
 * exposeWorker(new MyCustomWorker())
 */
export function exposeWorker<T extends OsmixWorker>(worker: T) {
	Comlink.expose(worker)
}
