import { ResizeableTypedArray } from "./chunked-array"
import type StringTable from "./stringtable"
import type { OsmEntity, OsmTags } from "./types"

export abstract class EntityIndex<T extends OsmEntity> {
	size = 0

	stringTable: StringTable
	tagStartByIndex = new ResizeableTypedArray(Uint32Array)
	tagCountByIndex = new ResizeableTypedArray(Uint32Array)
	tagIndexes = new ResizeableTypedArray(Uint32Array)

	private indexBuilt = false
	private idsAreSorted = true
	idByIndex = new ResizeableTypedArray(Float64Array)
	private idsSorted: Float64Array = new Float64Array(0)
	private sortedIdPositionToIndex: Uint32Array = new Uint32Array(0)
	private anchors: Float64Array = new Float64Array(0)
	private blockSize = 256

	constructor(stringTable: StringTable) {
		this.stringTable = stringTable
	}

	add(entity: T): void {
		if (this.indexBuilt) throw Error("ID index already built.")
		if (entity.id < this.idByIndex.at(-1)) this.idsAreSorted = false
		this.idByIndex.push(entity.id)
		this.addTags(entity.tags)
		this.size++
	}

	addTags(tags?: OsmTags) {
		const tagKeyValues: number[] = []
		if (tags) {
			for (const [key, value] of Object.entries(tags)) {
				tagKeyValues.push(this.stringTable.add(key))
				tagKeyValues.push(this.stringTable.add(value.toString()))
			}
		}

		this.tagStartByIndex.push(this.tagIndexes.length)
		this.tagCountByIndex.push(tagKeyValues.length)
		for (const tagKeyValueIndex of tagKeyValues) {
			this.tagIndexes.push(tagKeyValueIndex)
		}
	}

	idOrIndex(
		i: { id: number } | { index: number },
	): [index: number, id: number] {
		if ("id" in i) return [this.getIndexFromId(i.id), i.id]
		return [i.index, this.idByIndex.at(i.index)]
	}

	/**
	 * Build the index of IDs to positions.
	 *
	 * If the IDs are not sorted, we need to sort them and build a new index.
	 * If the IDs are sorted, we can use the existing index.
	 */
	buildIdIndex() {
		if (this.indexBuilt) throw Error("ID index already build.")
		console.time("EntityIndex.buildIdIndex")

		if (!this.idsAreSorted) {
			console.warn("OSM IDs were not sorted. Sorting now...")
			// Build the sorted index
			this.idsSorted = new Float64Array(this.size)
			this.sortedIdPositionToIndex = new Uint32Array(this.size)

			// Fill and sort with positions.
			for (let i = 0; i < this.size; i++) {
				this.idsSorted[i] = this.idByIndex.at(i)
				this.sortedIdPositionToIndex[i] = i
			}

			// Sort by id, carrying position; use native sort on chunks or a custom radix/merge for stability.
			// For simplicity:
			console.time("EntityIndex.buildIdIndex.sort")
			const tmp = Array.from({ length: this.size }, (_, i) => ({
				id: this.idsSorted[i],
				pos: this.sortedIdPositionToIndex[i],
			}))
			tmp.sort((a, b) => a.id - b.id)
			for (let i = 0; i < this.size; i++) {
				this.idsSorted[i] = tmp[i].id
				this.sortedIdPositionToIndex[i] = tmp[i].pos
			}
			console.timeEnd("EntityIndex.buildIdIndex.sort")
		} else {
			// Point to the same array
			this.idsSorted = this.idByIndex.array
		}

		// Build anchors (every blockSize-th key)
		const aLen = Math.ceil(this.size / this.blockSize)
		this.anchors = new Float64Array(aLen)
		for (let j = 0; j < aLen; j++) {
			this.anchors[j] =
				this.idsSorted[Math.min(j * this.blockSize, this.size - 1)]
		}

		this.indexBuilt = true
		console.timeEnd("EntityIndex.buildIdIndex")
	}

	abstract finishEntityIndex(): void

	finish() {
		console.time("EntityIndex.finish")
		this.idByIndex.compact()
		this.tagStartByIndex.compact()
		this.tagCountByIndex.compact()
		this.tagIndexes.compact()
		this.size = this.idByIndex.length
		this.buildIdIndex()
		this.finishEntityIndex()
		console.timeEnd("EntityIndex.finish")
	}

	isReady() {
		return this.indexBuilt
	}

	abstract getFullEntity(index: number, id: number, tags?: OsmTags): T

	hasTags(index: number): boolean {
		return this.tagCountByIndex.at(index) > 0
	}

	getTags(index: number): OsmTags | undefined {
		const tagCount = this.tagCountByIndex.at(index)
		if (tagCount === 0) return
		const tagStart = this.tagStartByIndex.at(index)
		const tagIndexes = this.tagIndexes.array.slice(
			tagStart,
			tagStart + tagCount,
		)
		const tags: OsmTags = {}
		for (let i = 0; i < tagCount; i += 2) {
			tags[this.stringTable.get(tagIndexes[i])] = this.stringTable.get(
				tagIndexes[i + 1],
			)
		}
		return tags
	}

	getByIndex(index: number): T | null {
		const id = this.idByIndex.at(index)
		if (id === -1) return null
		return this.getFullEntity(index, id, this.getTags(index))
	}

	getEntitiesByIndex(indexes: number[]): T[] {
		const entities: T[] = []
		for (const index of indexes) {
			const entity = this.getByIndex(index)
			if (entity) entities.push(entity)
			else throw Error(`Entity not found at index ${index}`)
		}
		return entities
	}

	getEntitiesById(ids: number[]): T[] {
		const entities: T[] = []
		for (const id of ids) {
			const entity = this.getById(id)
			if (entity) entities.push(entity)
			else throw Error(`Entity not found at ID ${id}`)
		}
		return entities
	}

	*[Symbol.iterator](): Generator<T> {
		for (let i = 0; i < this.size; i++) {
			const entity = this.getByIndex(i)
			if (entity) yield entity as T
			else console.error(`Entity not found at index ${i}`)
		}
	}

	// Lookup id → index
	getIndexFromId(id: number): number {
		if (!this.indexBuilt)
			throw Error("Index not built. You must call finish() first.")
		// binary search anchors
		let lo = 0
		let hi = this.anchors.length - 1
		while (lo < hi) {
			const mid = (lo + hi + 1) >>> 1
			if (this.anchors[mid] <= id) lo = mid
			else hi = mid - 1
		}
		const start = lo * this.blockSize
		const end = Math.min(start + this.blockSize, this.idsSorted.length)

		// binary search within block
		let l = start
		let r = end - 1
		while (l <= r) {
			const m = (l + r) >>> 1
			const v = this.idsSorted[m]
			if (v === id) {
				if (this.idsAreSorted) {
					return m
				}
				return this.sortedIdPositionToIndex[m]
			}
			if (v < id) l = m + 1
			else r = m - 1
		}

		// ID not found
		return -1
	}

	getById(id: number): T | null {
		const index = this.getIndexFromId(id)
		if (index === -1) return null
		return this.getByIndex(index)
	}

	abstract set(entity: T): void

	remove(id: number) {
		const index = this.getIndexFromId(id)
		if (index === -1) return
		this.idByIndex.array[index] = -1
	}
}
