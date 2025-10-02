import type { OsmPbfBlock, OsmPbfStringTable } from "@osmix/pbf"
import { type BufferType, ResizeableTypedArray } from "./typed-arrays"

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
	private bytes: ResizeableTypedArray<Uint8Array>
	private start: ResizeableTypedArray<Uint32Array>
	private count: ResizeableTypedArray<Uint16Array>

	// Builder state
	private stringToIndex = new Map<string, number>()

	// Retrieval state
	private indexToString = new Map<number, string>()

	static from({ bytes, start, count }: StringTableTransferables): StringTable {
		const builder = new StringTable()
		builder.bytes = ResizeableTypedArray.from(Uint8Array, bytes)
		builder.start = ResizeableTypedArray.from(Uint32Array, start)
		builder.count = ResizeableTypedArray.from(Uint16Array, count)
		return builder
	}

	constructor() {
		this.bytes = new ResizeableTypedArray(Uint8Array)
		this.start = new ResizeableTypedArray(Uint32Array)
		this.count = new ResizeableTypedArray(Uint16Array)
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
	createBlockIndexMap(block: OsmPbfBlock) {
		const map = new Map<number, number>()
		for (let i = 0; i < block.stringtable.length; i++) {
			const bytesString = block.stringtable[i]
			const str = this.dec.decode(bytesString)
			const index = this.add(str)
			map.set(i, index)
		}
		return map
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

	compact() {
		this.bytes.compact()
		this.start.compact()
		this.count.compact()

		this.stringToIndex.clear()
	}

	toOsmPbfStringTable(): OsmPbfStringTable {
		const stringTable: OsmPbfStringTable = []
		for (let i = 0; i < this.length; i++) {
			stringTable.push(this.getBytes(i))
		}
		return stringTable
	}
}
