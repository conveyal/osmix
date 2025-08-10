import type StringTable from "./stringtable"
import type { OsmEntity, OsmTags } from "./types"
import { IdIndex, type IdIndexTransferables, type IdOrIndex } from "./id-index"
import { TagIndex, type TagIndexTransferables } from "./tag-index"
import type { TypedArrayBufferConstructor } from "./typed-arrays"

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

	get(idOrIndex: IdOrIndex): T {
		const [index, id] = this.ids.idOrIndex(idOrIndex)
		return this.getFullEntity(index, id, this.tags.getTags(index))
	}

	getByIndex(index: number): T {
		const id = this.ids.at(index)
		if (id === -1) throw Error(`Entity not found at index ${index}`)
		return this.getFullEntity(index, id, this.tags.getTags(index))
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
			const entity = this.getByIndex(i)
			if (entity) yield entity as T
			else console.error(`Entity not found at index ${i}`)
		}
	}

	getById(id: number): T {
		const index = this.ids.getIndexFromId(id)
		if (index === -1) throw Error(`Entity not found for id ${id}`)
		return this.getByIndex(index)
	}
}
