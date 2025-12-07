import { supportsReadableStreamTransfer } from "./utils"

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
