/**
 * Concatenates multiple `Uint8Array` segments into a contiguous array.
 */
export function concatBytes(
	parts: Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
	const total = parts.reduce((n, p) => n + p.length, 0)
	const out = new Uint8Array<ArrayBuffer>(new ArrayBuffer(total))
	let offset = 0
	for (const p of parts) {
		out.set(p, offset)
		offset += p.length
	}
	return out
}
