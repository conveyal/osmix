import { ResizeableTypedArray } from "./chunked-array"
import type { OsmTags } from "./types"

export class TagStringTable {
	size = 0
	stringTable: string[]
	tagStartByIndex = new ResizeableTypedArray(Uint32Array)
	tagCountByIndex = new ResizeableTypedArray(Uint32Array)
	tagIndexes = new ResizeableTypedArray(Uint32Array)

	constructor(stringTable: string[]) {
		this.stringTable = stringTable
	}

	addString(s: string): number {
		const index = this.stringTable.indexOf(s)
		if (index === -1) {
			return this.stringTable.push(s) - 1
		}
		return index
	}

	addTags(tags?: Record<string, unknown>) {
		const tagKeyValues: number[] = []
		if (tags) {
			for (const [key, value] of Object.entries(tags)) {
				tagKeyValues.push(this.addString(key))
				tagKeyValues.push(this.addString(String(value)))
			}
		}

		this.tagStartByIndex.push(this.tagIndexes.length)
		this.tagCountByIndex.push(tagKeyValues.length)
		for (const tagKeyValueIndex of tagKeyValues) {
			this.tagIndexes.push(tagKeyValueIndex)
		}
	}

	hasTags(index: number): boolean {
		return this.tagCountByIndex.at(index) > 0
	}

	getTags(index: number): Record<string, string> | undefined {
		const tagCount = this.tagCountByIndex.at(index)
		if (tagCount === 0) return
		const tagStart = this.tagStartByIndex.at(index)
		const tagIndexes = this.tagIndexes.array.slice(
			tagStart,
			tagStart + tagCount,
		)
		const tags: Record<string, string> = {}
		for (let i = 0; i < tagCount; i += 2) {
			tags[this.stringTable[tagIndexes[i]]] =
				this.stringTable[tagIndexes[i + 1]]
		}
		return tags
	}
}
