import { IdIndex, type IdIndexTransferables, type IdOrIndex } from "./id-index"
import type StringTable from "./stringtable"
import { TagIndex, type TagIndexTransferables } from "./tag-index"
import type { OsmEntity, OsmTags } from "./types"

export interface EntityIndexTransferables
	extends IdIndexTransferables,
		TagIndexTransferables {}

export abstract class EntityIndex<T extends OsmEntity> {
	indexType: "node" | "way" | "relation"

	stringTable: StringTable
	ids: IdIndex
	tags: TagIndex

	constructor(
		indexType: "node" | "way" | "relation",
		stringTable: StringTable,
		ids?: IdIndex,
		tags?: TagIndex,
	) {
		this.stringTable = stringTable
		this.indexType = indexType
		this.ids = ids ?? new IdIndex()
		this.tags = tags ?? new TagIndex(stringTable)
	}

	get isReady() {
		return this.ids.isReady && this.tags.isReady
	}

	get size() {
		return this.ids.size
	}

	abstract finishEntityIndex(): void

	finish() {
		console.time(`${this.indexType}Index.finish`)
		this.ids.finish()
		this.tags.finish()
		this.finishEntityIndex()
		console.timeEnd(`${this.indexType}Index.finish`)
	}

	abstract getFullEntity(index: number, id: number, tags?: OsmTags): T

	get(idOrIndex: IdOrIndex): T | null {
		const [index, id] = this.ids.idOrIndex(idOrIndex)
		if (index === -1) return null
		return this.getFullEntity(index, id, this.tags.getTags(index))
	}

	getByIndex(index: number): T {
		return this.getFullEntity(
			index,
			this.ids.at(index),
			this.tags.getTags(index),
		)
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

	*[Symbol.iterator](): Generator<T> {
		for (let i = 0; i < this.size; i++) {
			yield this.getFullEntity(i, this.ids.at(i), this.tags.getTags(i))
		}
	}

	getById(id: number): T | null {
		const index = this.ids.getIndexFromId(id)
		if (index !== -1) return this.getByIndex(index)
		return null
	}
}
