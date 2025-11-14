import type { OsmPbfStringTable } from "@osmix/pbf"
import { type BufferType, ResizeableTypedArray as RTA } from "./typed-arrays"

export interface StringTableTransferables {
	bytes: BufferType
	start: BufferType
	count: BufferType
}

/**
 * StringTable that can be used to store and retrieve strings as bytes.
 */
export default class StringTable {
	private enc = new TextEncoder()
	private dec = new TextDecoder() // UTF-8

	// Serializable state
	bytes: RTA<Uint8Array>
	start: RTA<Uint32Array>
	count: RTA<Uint16Array>

	// Builder state
	private stringToIndex = new Map<string, number>()

	// Lazy-built reverse index for lookups after transfer/hydration
	private reverseIndexBuilt = false

	// Retrieval state
	private indexToString = new Map<number, string>()

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

	transferables(): StringTableTransferables {
		return {
			bytes: this.bytes.array.buffer,
			start: this.start.array.buffer,
			count: this.count.array.buffer,
		}
	}

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
	 * TextDecoder.decode() does not support SharedArrayBuffer, so we need to first copy to a normal ArrayBuffer before decoding.
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

	getBytes(index: number): Uint8Array {
		if (index < 0 || index >= this.length)
			throw Error(`String index out of range: ${index}`)
		const start = this.start.at(index)
		const count = this.count.at(index)
		// Important: subarray creates a *view*, not a copy; TextDecoder cannot read from it directly.
		return this.bytes.array.subarray(start, start + count)
	}

	get length() {
		return this.start.length
	}

	buildIndex() {
		this.bytes.compact()
		this.start.compact()
		this.count.compact()
		this.reverseIndexBuilt = true
	}

	toOsmPbfStringTable(): OsmPbfStringTable {
		const stringTable: OsmPbfStringTable = []
		for (let i = 0; i < this.length; i++) {
			stringTable.push(this.getBytes(i))
		}
		return stringTable
	}

	private ensureReverseIndex() {
		if (this.reverseIndexBuilt) return
		// Build string -> index map from existing decoded strings
		// Decode once per entry; subsequent get() calls are cached via indexToString
		for (let i = 0; i < this.length; i++) {
			this.stringToIndex.set(this.get(i), i)
		}
		this.reverseIndexBuilt = true
	}

	find(str: string): number {
		const existing = this.stringToIndex.get(str)
		if (existing !== undefined) return existing
		this.ensureReverseIndex()
		return this.stringToIndex.get(str) ?? -1
	}
}
