/**
 * Deduplicated UTF-8 string storage.
 *
 * Strings are stored in a flat buffer and referenced by index.
 * Supports fast deduplication (string→index) and lazy reconstruction (index→string).
 *
 * @module
 */

import type { OsmPbfStringTable } from "@osmix/pbf"
import type { ContentHasher } from "@osmix/shared/content-hasher"
import { type BufferType, ResizeableTypedArray as RTA } from "./typed-arrays"

/**
 * Serializable state for worker transfer.
 */
export interface StringTableTransferables<T extends BufferType = BufferType> {
	/** Concatenated UTF-8 bytes. */
	bytes: T
	/** Maps string index → byte offset. */
	start: T
	/** Maps string index → byte length. */
	count: T
}

/**
 * Append-only deduplicated string table.
 *
 * Limits: Max string length 65,535 bytes.
 * Rebuilds reverse index lazily after transfer.
 */
export default class StringTable {
	/** UTF-8 encoder for string→bytes conversion */
	private enc = new TextEncoder()
	/** UTF-8 decoder for bytes→string conversion */
	private dec = new TextDecoder() // UTF-8

	// ─── Serializable State ────────────────────────────────────────────────────
	/** Concatenated UTF-8 bytes of all strings */
	bytes: RTA<Uint8Array>
	/** Maps string index → byte offset in bytes array */
	start: RTA<Uint32Array>
	/** Maps string index → byte length */
	count: RTA<Uint16Array>

	// ─── Builder State (string → index) ────────────────────────────────────────
	/** Forward lookup: string → index (populated during add) */
	private stringToIndex = new Map<string, number>()

	/** Whether the reverse index has been built (lazy after transfer) */
	private reverseIndexBuilt = false

	// ─── Retrieval Cache (index → string) ──────────────────────────────────────
	/** Cache of decoded strings to avoid repeated UTF-8 decoding */
	private indexToString = new Map<number, string>()

	/**
	 * Create a new StringTable.
	 */
	constructor(opts?: StringTableTransferables) {
		this.bytes = opts?.bytes
			? RTA.from(Uint8Array, opts.bytes)
			: new RTA(Uint8Array)
		this.start = opts?.start
			? RTA.from(Uint32Array, opts.start)
			: new RTA(Uint32Array)
		this.count = opts?.count
			? RTA.from(Uint16Array, opts.count)
			: new RTA(Uint16Array)
	}

	/**
	 * Get transferable objects for passing to another thread.
	 */
	transferables(): StringTableTransferables {
		return {
			bytes: this.bytes.array.buffer,
			start: this.start.array.buffer,
			count: this.count.array.buffer,
		}
	}

	/**
	 * Add a string to the table and return its index.
	 */
	add(str: string): number {
		const existingIndex = this.stringToIndex.get(str)
		if (existingIndex !== undefined) return existingIndex
		const startIndex = this.start.length
		const encoded = this.enc.encode(str)
		this.start.push(this.bytes.length)
		this.bytes.pushMany(encoded)
		this.count.push(encoded.length)
		this.stringToIndex.set(str, startIndex)
		return startIndex
	}

	/**
	 * Decode all the strings in a primitive block and add them to the string table.
	 * Return a mapping of block index -> string table index
	 */
	createBlockIndexMap(blockStringtable: OsmPbfStringTable) {
		const index = new Uint32Array(blockStringtable.length)
		for (let i = 0; i < blockStringtable.length; i++) {
			const bytesString = blockStringtable[i]
			const str = this.dec.decode(bytesString)
			const existingIndex = this.stringToIndex.get(str)
			if (existingIndex !== undefined) {
				index[i] = existingIndex
				continue
			}
			index[i] = this.add(str)
		}
		return index
	}

	/**
	 * Get a string by its index.
	 * Caches results to avoid repeated UTF-8 decoding.
	 */
	get(index: number): string {
		const string = this.indexToString.get(index)
		if (string) return string
		const bytes = this.getBytes(index)
		const tempBuffer = new ArrayBuffer(bytes.byteLength)
		const tempBytes = new Uint8Array(tempBuffer)
		tempBytes.set(bytes)
		const decoded = this.dec.decode(tempBytes)
		this.indexToString.set(index, decoded)
		return decoded
	}

	/**
	 * Get the raw UTF-8 bytes of a string.
	 * Returns a subarray view (not a copy).
	 */
	getBytes(index: number): Uint8Array {
		if (index < 0 || index >= this.length)
			throw Error(`String index out of range: ${index}`)
		const start = this.start.at(index)
		const count = this.count.at(index)
		return this.bytes.array.subarray(start, start + count)
	}

	/** Number of strings in the table. */
	get length() {
		return this.start.length
	}

	/**
	 * Finalize the string table by compacting internal arrays.
	 *
	 * This releases unused buffer capacity and marks the reverse index as built
	 * (since all strings were added before this call).
	 */
	buildIndex() {
		this.bytes.compact()
		this.start.compact()
		this.count.compact()
		this.reverseIndexBuilt = true
	}

	/**
	 * Convert the string table to an OSM PBF string table.
	 */
	toOsmPbfStringTable(): OsmPbfStringTable {
		const stringTable: OsmPbfStringTable = []
		for (let i = 0; i < this.length; i++) {
			stringTable.push(this.getBytes(i))
		}
		return stringTable
	}

	/**
	 * Lazily build the reverse index (string → index).
	 * Decodes all strings once to populate the lookup map.
	 */
	private ensureReverseIndex() {
		if (this.reverseIndexBuilt) return
		// Decode all strings and populate the forward lookup map
		for (let i = 0; i < this.length; i++) {
			this.stringToIndex.set(this.get(i), i)
		}
		this.reverseIndexBuilt = true
	}

	/**
	 * Find the index of a string.
	 */
	find(str: string): number {
		const existing = this.stringToIndex.get(str)
		if (existing !== undefined) return existing
		this.ensureReverseIndex()
		return this.stringToIndex.get(str) ?? -1
	}

	/**
	 * Update a ContentHasher with the string table's data.
	 * Hashes the bytes, start offsets, and counts.
	 */
	updateHash(hasher: ContentHasher): ContentHasher {
		return hasher
			.update(this.bytes.array)
			.update(this.start.array)
			.update(this.count.array)
	}
}
