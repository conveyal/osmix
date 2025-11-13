/**
 * Collect all ArrayBufferLike values from a nested object. Usually to be transferred to or from a worker.
 */
export function collectBuffers(value: unknown): ArrayBufferLike[] {
	const buffers: ArrayBufferLike[] = []

	if (value instanceof ArrayBuffer) buffers.push(value)
	else if (ArrayBuffer.isView(value)) buffers.push(value.buffer)
	else if (Array.isArray(value)) {
		for (const item of value) {
			buffers.push(...collectBuffers(item))
		}
	} else if (value && typeof value === "object") {
		for (const item of Object.values(value)) {
			buffers.push(...collectBuffers(item))
		}
	}

	return buffers
}
