import type { OsmPbfStringTable } from "./pbf"
import {
	BufferConstructor,
	ResizeableTypedArray,
	type TypedArrayBuffer,
} from "./typed-arrays"

/**
 * 64-bit FNV-1a over the given bytes. Returns lowercase hex string of 16 chars.
 * Uses BigInt to avoid precision loss.
 */
function hash64Fnv1a(u8: Uint8Array): string {
	let hash = 0xcbf29ce484222325n // FNV offset bias 64-bit
	const prime = 0x100000001b3n // FNV prime 64-bit
	for (const b of u8) {
		hash ^= BigInt(b)
		hash = (hash * prime) & 0xffffffffffffffffn // keep to 64 bits
	}
	// Render as fixed-width 16-hex string
	let hex = hash.toString(16)
	if (hex.length < 16) hex = "0".repeat(16 - hex.length) + hex
	return hex
}

/**
 * Byte-wise equality check between the builder store at `start` and the given `u8`.
 */
function bytesEqual(store: Uint8Array, start: number, u8: Uint8Array) {
	for (let i = 0; i < u8.length; i++) {
		if (store[start + i] !== u8[i]) return false
	}
	return true
}

export type StringTableTransferables = {
	bytes: TypedArrayBuffer
	offsets: TypedArrayBuffer
}

/**
 * StringTable that can be used to store and retrieve strings as bytes.
 */
export default class StringTable {
	private enc = new TextEncoder()
	private dec = new TextDecoder() // UTF-8

	// Retrieval state
	private bytes: ResizeableTypedArray<Uint8Array>
	private offsets: Uint32Array

	// Builder state
	private builderOffsets: number[] = [0] // start with 0; push cumulative byte length
	private byteHashToIndices = new Map<string, number[]>() // hash->candidate indices for byte-level dedupe

	private isCompacted = false

	static from({ bytes, offsets }: StringTableTransferables): StringTable {
		const builder = new StringTable()
		builder.bytes = ResizeableTypedArray.from(Uint8Array, bytes)
		builder.offsets = new Uint32Array(offsets)
		builder.isCompacted = true
		return builder
	}

	constructor() {
		this.bytes = new ResizeableTypedArray(Uint8Array)
		this.offsets = new Uint32Array(new BufferConstructor(0))
	}

	transferables(): StringTableTransferables {
		return {
			bytes: this.bytes.array.buffer,
			offsets: this.offsets.buffer,
		}
	}

	add(s: string): number {
		const encoded = this.enc.encode(s)
		return this.addBytes(encoded)
	}

	/**
	 * TextDecoder.decode() does not support SharedArrayBuffer, so we need to first copy to a normal ArrayBuffer before decoding.
	 */
	get(index: number): string {
		const bytes = this.getBytes(index)
		const tempBuffer = new ArrayBuffer(bytes.byteLength)
		const tempBytes = new Uint8Array(tempBuffer)
		tempBytes.set(bytes)
		return this.dec.decode(tempBytes)
	}

	getBytes(index: number): Uint8Array {
		if (index < 0 || index >= this.length)
			throw Error(`String index out of range: ${index}`)
		const start = this.offsets[index]
		const end = this.offsets[index + 1]
		// Important: subarray creates a *view*, not a copy; TextDecoder cannot read from it directly.
		return this.bytes.array.subarray(start, end)
	}

	/**
	 * Add a string given as raw UTF-8 bytes without decoding on the builder side.
	 * Deduplication is content-addressed using a 64-bit FNV-1a hash + length, with
	 * byte-for-byte verification to avoid collision issues.
	 */
	addBytes(u8: Uint8Array<TypedArrayBuffer>) {
		const len = u8.length
		const hash = hash64Fnv1a(u8) // string key (hex)
		const bucketKey = `${hash}:${len}` // length guards most collisions
		const candidates = this.byteHashToIndices.get(bucketKey)

		if (candidates) {
			for (const idx of candidates) {
				const start = this.builderOffsets[idx]
				const end = this.builderOffsets[idx + 1]
				if (end === undefined || start === undefined || end - start !== len)
					continue
				if (bytesEqual(this.bytes.array, start, u8)) return idx
			}
		}

		// Not found: append bytes and record index
		const currLen = this.builderOffsets[this.builderOffsets.length - 1] ?? 0
		const nextLen = currLen + len
		while (nextLen > this.bytes.buffer.byteLength) this.bytes.expandArray()
		this.bytes.pushMany(u8)
		this.builderOffsets.push(nextLen)

		const newIdx = this.builderOffsets.length - 2 // string index
		if (candidates) candidates.push(newIdx)
		else this.byteHashToIndices.set(bucketKey, [newIdx])
		return newIdx
	}

	get length() {
		return this.isCompacted
			? this.offsets.length - 1
			: this.builderOffsets.length - 1
	}

	compact() {
		const count = this.length
		this.bytes.compact()

		// Copy offsets into a new buffer (Uint32; supports up to ~4GB byte offsets)
		const offsetsSAB = new BufferConstructor((count + 1) * 4)
		this.offsets = new Uint32Array(offsetsSAB)
		this.builderOffsets.forEach((offset, i) => {
			this.offsets[i] = offset
		})

		// Clear the builder state
		this.builderOffsets = []
		this.byteHashToIndices = new Map()
		this.isCompacted = true
	}

	toOsmPbfStringTable(): OsmPbfStringTable {
		const stringTable: OsmPbfStringTable = []
		for (let i = 0; i < this.length; i++) {
			stringTable.push(this.getBytes(i))
		}
		return stringTable
	}
}
