import { ResizeableIndexArray, ResizeableTypedArray } from "./typed-arrays"
import type StringTable from "./stringtable"
import type { OsmTags } from "./types"

export class TagIndex {
	private stringTable: StringTable
	private tagStartByIndex = new ResizeableIndexArray()
	private tagCountByIndex = new ResizeableTypedArray(Uint8Array) // Maximum 255 tags per entity
	private tagKeyIndexes = new ResizeableIndexArray()
	private tagValIndexes = new ResizeableIndexArray()

	private indexBuilt = false

	constructor(stringTable: StringTable) {
		this.stringTable = stringTable
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
		this.tagStartByIndex.push(this.tagKeyIndexes.length)
		this.tagCountByIndex.push(keys.length)
		this.tagKeyIndexes.pushMany(keys)
		this.tagValIndexes.pushMany(values)
	}

	finish() {
		this.tagStartByIndex.compact()
		this.tagCountByIndex.compact()
		this.tagKeyIndexes.compact()
		this.tagValIndexes.compact()
		this.indexBuilt = true
	}

	get isReady() {
		return this.indexBuilt
	}

	hasTags(index: number): boolean {
		return this.tagCountByIndex.at(index) > 0
	}

	getTags(index: number): OsmTags | undefined {
		const tagCount = this.tagCountByIndex.at(index)
		if (tagCount === 0) return
		const tagStart = this.tagStartByIndex.at(index)
		const tagKeyIndexes = this.tagKeyIndexes.array.slice(
			tagStart,
			tagStart + tagCount,
		)
		const tagValIndexes = this.tagValIndexes.array.slice(
			tagStart,
			tagStart + tagCount,
		)
		const tags: OsmTags = {}
		for (let i = 0; i < tagCount; i++) {
			tags[this.stringTable.get(tagKeyIndexes[i])] = this.stringTable.get(
				tagValIndexes[i],
			)
		}
		return tags
	}
}
