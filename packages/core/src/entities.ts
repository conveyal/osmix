import type { OsmEntity, OsmEntityType, OsmTags } from "@osmix/json"
import { type IdOrIndex, Ids, type IdsTransferables } from "./ids"
import type StringTable from "./stringtable"
import { Tags, type TagsTransferables } from "./tags"

export interface EntitiesTransferables
	extends IdsTransferables,
		TagsTransferables {}

export abstract class Entities<T extends OsmEntity> {
	indexType: OsmEntityType
	stringTable: StringTable
	ids: Ids
	tags: Tags

	private indexBuilt = false

	constructor(
		indexType: OsmEntityType,
		stringTable: StringTable,
		ids?: Ids,
		tags?: Tags,
	) {
		this.stringTable = stringTable
		this.indexType = indexType
		this.ids = ids ?? new Ids()
		this.tags = tags ?? new Tags(stringTable)
	}

	get isReady() {
		return this.ids.isReady && this.tags.isReady && this.indexBuilt
	}

	get size() {
		return this.ids.size
	}

	abstract buildEntityIndex(): void

	buildIndex() {
		console.time(`${this.indexType}Index.finish`)
		this.ids.buildIndex()
		this.tags.buildIndex()
		this.buildEntityIndex()
		this.indexBuilt = true
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
		if (index !== -1)
			return this.getFullEntity(index, id, this.tags.getTags(index))
		return null
	}

	*sorted(): Generator<T> {
		for (const id of this.ids.sorted) {
			const index = this.ids.getIndexFromId(id)
			if (index === -1) throw Error(`Entity not found at id ${id}`)
			yield this.getFullEntity(index, id, this.tags.getTags(index))
		}
	}
}
