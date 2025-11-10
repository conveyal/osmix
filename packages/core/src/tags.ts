import type { OsmTags } from "@osmix/json"
import type StringTable from "./stringtable"
import { type BufferType, ResizeableTypedArray as RTA } from "./typed-arrays"

export interface TagsTransferables {
	tagStart: BufferType
	tagCount: BufferType
	tagKeys: BufferType
	tagVals: BufferType

	keyEntities: BufferType
	keyIndexStart: BufferType
	keyIndexCount: BufferType
}

export class Tags {
	private stringTable: StringTable

	// Entity -> tag look up
	private tagStart: RTA<Uint32Array>
	private tagCount: RTA<Uint8Array>
	private tagKeys: RTA<Uint32Array>
	private tagVals: RTA<Uint32Array>

	/**
	 * Tag -> entity look up indexes for keys.
	 */
	private keyEntities: RTA<Uint32Array>

	/**
	 * Look up string index -> start and count of entities with that string index.
	 */
	private keyIndexStart: RTA<Uint32Array>
	private keyIndexCount: RTA<Uint32Array>

	/**
	 * Store look up indexes for entities by their string index. Cleared after building the final index.
	 */
	private keyEntityIndexBuilder = new Map<number, number[]>()

	private indexBuilt = false

	constructor(stringTable: StringTable, transferables?: TagsTransferables) {
		this.stringTable = stringTable
		if (transferables) {
			this.tagStart = RTA.from(Uint32Array, transferables.tagStart)
			this.tagCount = RTA.from(Uint8Array, transferables.tagCount)
			this.tagKeys = RTA.from(Uint32Array, transferables.tagKeys)
			this.tagVals = RTA.from(Uint32Array, transferables.tagVals)
			this.keyEntities = RTA.from(Uint32Array, transferables.keyEntities)
			this.keyIndexStart = RTA.from(Uint32Array, transferables.keyIndexStart)
			this.keyIndexCount = RTA.from(Uint32Array, transferables.keyIndexCount)
			this.indexBuilt = true
		} else {
			this.tagStart = new RTA(Uint32Array)
			this.tagCount = new RTA(Uint8Array)
			this.tagKeys = new RTA(Uint32Array)
			this.tagVals = new RTA(Uint32Array)
			this.keyEntities = new RTA(Uint32Array)
			this.keyIndexStart = new RTA(Uint32Array)
			this.keyIndexCount = new RTA(Uint32Array)
		}
	}

	addTags(index: number, tags?: OsmTags): [number[], number[]] {
		const tagKeys: number[] = []
		const tagValues: number[] = []

		if (tags) {
			for (const [key, value] of Object.entries(tags)) {
				tagKeys.push(this.stringTable.add(key))
				tagValues.push(this.stringTable.add(String(value)))
			}
		}

		this.addTagKeysAndValues(index, tagKeys, tagValues)

		return [tagKeys, tagValues]
	}

	addTagKeysAndValues(index: number, keys: number[], values: number[]) {
		this.tagStart.set(index, this.tagKeys.length)
		this.tagCount.set(index, keys.length)
		this.tagKeys.pushMany(keys)
		this.tagVals.pushMany(values)

		keys.forEach((key) => {
			const keyEntities = this.keyEntityIndexBuilder.get(key)
			if (keyEntities) {
				keyEntities.push(index)
			} else {
				this.keyEntityIndexBuilder.set(key, [index])
			}
		})
	}

	buildIndex() {
		this.tagStart.compact()
		this.tagCount.compact()
		this.tagKeys.compact()
		this.tagVals.compact()

		for (const [keyIndex, entityIndexes] of this.keyEntityIndexBuilder) {
			this.keyIndexStart.set(keyIndex, this.keyEntities.length)
			this.keyIndexCount.set(keyIndex, entityIndexes.length)
			this.keyEntities.pushMany(entityIndexes)
		}

		this.keyIndexStart.compact()
		this.keyIndexCount.compact()
		this.keyEntityIndexBuilder.clear()

		this.indexBuilt = true
	}

	isReady() {
		return this.indexBuilt
	}

	cardinality(index: number): number {
		return this.tagCount.at(index) ?? 0
	}

	getTags(index: number): OsmTags | undefined {
		const tagCount = this.tagCount.at(index) ?? 0
		if (tagCount === 0) return
		const tagStart = this.tagStart.at(index) ?? 0
		const tagKeyIndexes = this.tagKeys.array.slice(
			tagStart,
			tagStart + tagCount,
		)
		const tagValIndexes = this.tagVals.array.slice(
			tagStart,
			tagStart + tagCount,
		)
		const tags: OsmTags = {}
		for (let i = 0; i < tagCount; i++) {
			const keyIndex = tagKeyIndexes[i]
			const valIndex = tagValIndexes[i]
			if (keyIndex === undefined || valIndex === undefined)
				throw Error("Tag key or value not found")
			tags[this.stringTable.get(keyIndex)] = this.stringTable.get(valIndex)
		}
		return tags
	}

	getTagsFromIndices(keys: number[], values: number[]): OsmTags {
		const tags: OsmTags = {}
		for (let i = 0; i < keys.length; i++) {
			const keyIndex = keys[i]
			const valIndex = values[i]
			if (keyIndex === undefined || valIndex === undefined)
				throw Error("Tag key or value not found")
			tags[this.stringTable.get(keyIndex)] = this.stringTable.get(valIndex)
		}
		return tags
	}

	find(key: string): number {
		return this.stringTable.find(key)
	}

	hasKey(keyIndex: number): number[] {
		if (keyIndex < 0) return []
		const start = this.keyIndexStart.at(keyIndex) ?? 0
		const count = this.keyIndexCount.at(keyIndex) ?? 0
		return Array.from(this.keyEntities.array.subarray(start, start + count))
	}

	/**
	 * Create a unique index for a key=value pair.
	 */
	kvToIndex(key: number, val: number) {
		const width = this.stringTable.length
		return key * width + val
	}

	/**
	 * Create transferable buffers and data from a Tags instance that can be sent across message channels and recreated
	 * in other threads.
	 */
	transferables(): TagsTransferables {
		return {
			tagStart: this.tagStart.array.buffer,
			tagCount: this.tagCount.array.buffer,
			tagKeys: this.tagKeys.array.buffer,
			tagVals: this.tagVals.array.buffer,
			keyEntities: this.keyEntities.array.buffer,
			keyIndexStart: this.keyIndexStart.array.buffer,
			keyIndexCount: this.keyIndexCount.array.buffer,
		}
	}

	static fromTransferables(
		stringTable: StringTable,
		transferables: TagsTransferables,
	) {
		const tagIndex = new Tags(stringTable, transferables)
		tagIndex.indexBuilt = true
		return tagIndex
	}
}
