import * as Comlink from "comlink"

export type Transferable = ArrayBufferLike | ReadableStream

/**
 * Collect all transferable values from a nested object. Usually to be transferred to or from a worker.
 */
export function collectTransferables(value: unknown): Transferable[] {
	const transferables: Transferable[] = []

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
