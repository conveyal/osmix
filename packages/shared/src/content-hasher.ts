// FNV-1a hash constants (32-bit)
const FNV_OFFSET_BASIS = 2166136261
const FNV_PRIME = 16777619

/**
 * FNV-1a hash implementation for Uint8Array.
 * Fast, non-cryptographic hash suitable for content comparison.
 */
function fnv1aHash(data: Uint8Array, initialHash = FNV_OFFSET_BASIS): number {
	let hash = initialHash
	for (let i = 0; i < data.length; i++) {
		hash ^= data[i] as number
		hash = Math.imul(hash, FNV_PRIME) >>> 0
	}
	return hash >>> 0
}

/**
 * Hash state that can be incrementally updated with multiple buffers.
 */
export class ContentHasher {
	private hash = FNV_OFFSET_BASIS

	/**
	 * Update the hash with a typed array's underlying bytes.
	 */
	update(data: ArrayBufferView | ArrayBuffer): this {
		const buffer = data instanceof ArrayBuffer ? data : data.buffer
		const bytes = new Uint8Array(buffer)
		this.hash = fnv1aHash(bytes, this.hash)
		return this
	}

	/**
	 * Update the hash with a number (as 8 bytes).
	 */
	updateNumber(n: number): this {
		const buffer = new ArrayBuffer(8)
		new Float64Array(buffer)[0] = n
		return this.update(buffer)
	}

	/**
	 * Get the final hash as a hex string.
	 */
	digest(): string {
		return this.hash.toString(16).padStart(8, "0")
	}

	/**
	 * Get the raw hash value.
	 */
	digestNumber(): number {
		return this.hash
	}
}

/**
 * Create a content hash from multiple typed arrays.
 * Returns a hex string suitable for use as a content identifier.
 */
export function hashBuffers(
	...buffers: (ArrayBufferView | ArrayBuffer)[]
): string {
	const hasher = new ContentHasher()
	for (const buffer of buffers) {
		hasher.update(buffer)
	}
	return hasher.digest()
}
