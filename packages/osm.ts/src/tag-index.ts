import {
	IndexArrayType,
	ResizeableTypedArray,
	type TypedArrayBuffer,
} from "./typed-arrays"
import type StringTable from "./stringtable"
import type { OsmTags } from "./types"

export type TagIndexTransferables = {
	tagStart: TypedArrayBuffer
	tagCount: TypedArrayBuffer
	tagKeys: TypedArrayBuffer
	tagVals: TypedArrayBuffer
}

export class TagIndex {
	private stringTable: StringTable
	private tagStart = new ResizeableTypedArray(IndexArrayType)
	private tagCount = new ResizeableTypedArray(Uint8Array) // Maximum 255 tags per entity
	private tagKeys = new ResizeableTypedArray(IndexArrayType)
	private tagVals = new ResizeableTypedArray(IndexArrayType)

	private indexBuilt = false

	static from(
		stringTable: StringTable,
		{ tagStart, tagCount, tagKeys, tagVals }: TagIndexTransferables,
	) {
		const tagIndex = new TagIndex(stringTable)
		tagIndex.tagStart = ResizeableTypedArray.from(IndexArrayType, tagStart)
		tagIndex.tagCount = ResizeableTypedArray.from(Uint8Array, tagCount)
		tagIndex.tagKeys = ResizeableTypedArray.from(IndexArrayType, tagKeys)
		tagIndex.tagVals = ResizeableTypedArray.from(IndexArrayType, tagVals)
		tagIndex.indexBuilt = true
		return tagIndex
	}

	constructor(stringTable: StringTable) {
		this.stringTable = stringTable
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

	finish() {
		this.tagStart.compact()
		this.tagCount.compact()
		this.tagKeys.compact()
		this.tagVals.compact()
		this.indexBuilt = true
	}

	get isReady() {
		return this.indexBuilt
	}

	hasTags(index: number): boolean {
		return (this.tagCount.at(index) ?? 0) > 0
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
}
