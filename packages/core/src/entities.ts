import type {
	GeoBbox2D,
	OsmEntity,
	OsmEntityType,
	OsmTags,
} from "@osmix/shared/types"
import type { IdOrIndex, Ids, IdsTransferables } from "./ids"
import type { Tags, TagsTransferables } from "./tags"

export interface EntitiesTransferables
	extends IdsTransferables,
		TagsTransferables {}

export abstract class Entities<T extends OsmEntity> {
	indexType: OsmEntityType
	ids: Ids
	tags: Tags

	protected indexBuilt = false

	constructor(indexType: OsmEntityType, ids: Ids, tags: Tags) {
		this.indexType = indexType
		this.ids = ids
		this.tags = tags
	}

	transferables(): EntitiesTransferables {
		return {
			...this.ids.transferables(),
			...this.tags.transferables(),
		}
	}

	isReady() {
		return this.ids.isReady() && this.tags.isReady() && this.indexBuilt
	}

	get size() {
		return this.ids.size
	}

	abstract buildEntityIndex(): void

	buildIndex() {
		if (this.indexBuilt) return
		console.time(`${this.indexType}Index.buildIndex`)
		this.ids.buildIndex()
		this.tags.buildIndex()
		this.buildEntityIndex()
		this.indexBuilt = true
		console.timeEnd(`${this.indexType}Index.buildIndex`)
	}

	abstract getNodeBbox(idOrIndex: IdOrIndex): GeoBbox2D

	abstract getFullEntity(index: number, id: number, tags?: OsmTags): T

	/**
	 * Add an entity to the index. Tags can be provided as an array of keys and values, or as an object.
	 */
	addEntity(id: number, tags: number[], values: number[]): number
	addEntity(id: number, tags: OsmTags): number
	addEntity(id: number, tags: OsmTags | number[], values?: number[]): number {
		const entityIndex = this.ids.add(id)
		if (Array.isArray(tags)) {
			if (values === undefined)
				throw Error("Values are required when tags is an array")
			this.tags.addTagKeysAndValues(entityIndex, tags, values)
		} else {
			this.tags.addTags(entityIndex, tags)
		}
		return entityIndex
	}

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

	search(key: string, val?: string): T[] {
		const keyIndex = this.tags.find(key)
		const entities = this.tags
			.hasKey(keyIndex)
			.map((index) => this.getByIndex(index))
		if (val === undefined) return entities
		return entities.filter((entity) => entity.tags?.[key] === val)
	}
}
