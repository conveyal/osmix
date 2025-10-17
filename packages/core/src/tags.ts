import type { OsmTags } from "@osmix/json"
import type StringTable from "./stringtable"
import { type BufferType, ResizeableTypedArray } from "./typed-arrays"

export interface TagsTransferables {
	tagStart: BufferType
	tagCount: BufferType
	tagKeys: BufferType
	tagVals: BufferType
}

export class Tags {
	private stringTable: StringTable
	private tagStart: ResizeableTypedArray<Uint32Array>
	private tagCount: ResizeableTypedArray<Uint8Array>
	private tagKeys: ResizeableTypedArray<Uint32Array>
	private tagVals: ResizeableTypedArray<Uint32Array>

	private indexBuilt = false

	static from(
		stringTable: StringTable,
		{ tagStart, tagCount, tagKeys, tagVals }: TagsTransferables,
	) {
		const tagIndex = new Tags(stringTable)
		tagIndex.tagStart = ResizeableTypedArray.from(Uint32Array, tagStart)
		tagIndex.tagCount = ResizeableTypedArray.from(Uint8Array, tagCount)
		tagIndex.tagKeys = ResizeableTypedArray.from(Uint32Array, tagKeys)
		tagIndex.tagVals = ResizeableTypedArray.from(Uint32Array, tagVals)
		tagIndex.indexBuilt = true
		return tagIndex
	}

	constructor(stringTable: StringTable) {
		this.stringTable = stringTable
		this.tagStart = new ResizeableTypedArray(Uint32Array)
		this.tagCount = new ResizeableTypedArray(Uint8Array)
		this.tagKeys = new ResizeableTypedArray(Uint32Array)
		this.tagVals = new ResizeableTypedArray(Uint32Array)
	}

	transferables() {
		return {
			tagStart: this.tagStart.array.buffer,
			tagCount: this.tagCount.array.buffer,
			tagKeys: this.tagKeys.array.buffer,
			tagVals: this.tagVals.array.buffer,
		}
	}

	addTags(tags?: OsmTags) {
		const tagKeys: number[] = []
		const tagValues: number[] = []

		if (tags) {
			for (const [key, value] of Object.entries(tags)) {
				tagKeys.push(this.stringTable.add(key))
				tagValues.push(this.stringTable.add(String(value)))
			}
		}

		this.addTagKeysAndValues(tagKeys, tagValues)
	}

	addTagKeysAndValues(keys: number[], values: number[]) {
		this.tagStart.push(this.tagKeys.length)
		this.tagCount.push(keys.length)
		this.tagKeys.pushMany(keys)
		this.tagVals.pushMany(values)
	}

	buildIndex() {
		this.tagStart.compact()
		this.tagCount.compact()
		this.tagKeys.compact()
		this.tagVals.compact()
		this.indexBuilt = true
	}

	get isReady() {
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
			tags[this.stringTable.get(keys[i])] = this.stringTable.get(values[i])
		}
		return tags
	}
}
