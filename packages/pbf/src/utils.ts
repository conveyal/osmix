import { transformBytes } from "@osmix/shared/transform-bytes"

export type AsyncGeneratorValue<T> =
	| T
	| ReadableStream<T>
	| AsyncGenerator<T>
	| Promise<T>
	| Promise<ReadableStream<T>>
	| Promise<AsyncGenerator<T>>

/**
 * Normalizes values, streams, and iterables into a unified async generator interface.
 */
export async function* toAsyncGenerator<T>(
	v: AsyncGeneratorValue<T>,
): AsyncGenerator<T> {
	if (v instanceof Promise) return toAsyncGenerator(await v)

	if (v == null) throw Error("Value is null")
	if (v instanceof ReadableStream) {
		const reader = v.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			yield value
		}
		reader.releaseLock()
	} else if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) {
		// Treat ArrayBuffer and TypedArrays (like Uint8Array, Buffer) as single values
		yield v as T
	} else if (
		typeof v === "object" &&
		(Symbol.asyncIterator in v || Symbol.iterator in v)
	) {
		return v
	} else {
		yield v
	}
}

/**
 * Returns true when executing inside the Bun runtime.
 */
export function isBun(): boolean {
	return "Bun" in globalThis
}

/**
 * Web decompression stream
 */
export async function webDecompress(
	data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	return transformBytes(data, new DecompressionStream("deflate"))
}

/**
 * Web compression stream
 */
export async function webCompress(
	data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	return transformBytes(data, new CompressionStream("deflate"))
}

/**
 * Concatenates multiple `Uint8Array` segments into a contiguous array.
 */
export function concatUint8(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((n, p) => n + p.length, 0)
	const out = new Uint8Array(total)
	let offset = 0
	for (const p of parts) {
		out.set(p, offset)
		offset += p.length
	}
	return out
}

/**
 * Encodes a 32-bit big-endian unsigned integer as a four-byte buffer.
 */
export function uint32BE(n: number): Uint8Array {
	const out = new Uint8Array(4)
	out[0] = (n >>> 24) & 0xff
	out[1] = (n >>> 16) & 0xff
	out[2] = (n >>> 8) & 0xff
	out[3] = n & 0xff
	return out
}
