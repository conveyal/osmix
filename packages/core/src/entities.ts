/**
 * Base class for OSM entity collections.
 *
 * Provides common ID and tag storage, streaming iteration, and sorted access.
 * Subclasses implement entity-specific storage and spatial indexing.
 *
 * @module
 */

import type {
	GeoBbox2D,
	OsmEntity,
	OsmEntityType,
	OsmTags,
} from "@osmix/shared/types"
import type { IdOrIndex, Ids, IdsTransferables } from "./ids"
import type { Tags, TagsTransferables } from "./tags"
import type { BufferType } from "./typed-arrays"

/**
 * Serializable representation of an Entities collection for worker transfer.
 * Combines ID and tag transferables; subclasses add entity-specific data.
 */
export interface EntitiesTransferables<T extends BufferType = BufferType>
	extends IdsTransferables<T>,
		TagsTransferables<T> {}

/**
 * Abstract base for typed entity collections.
 *
 * Lifecycle:
 * 1. **Ingest**: `addEntity()` (no lookups).
 * 2. **Finalize**: `buildIndex()`.
 * 3. **Query**: Lookups and iteration enabled.
 */
export abstract class Entities<T extends OsmEntity> {
	/** The type of entity stored in this collection ("node", "way", or "relation"). */
	indexType: OsmEntityType
	/** ID storage and lookup */
	ids: Ids
	/** Tag storage and search */
	tags: Tags

	/** Whether buildIndex() has been called */
	protected indexBuilt = false

	/**
	 * Create a new Entities collection.
	 * @param indexType - The entity type ("node", "way", or "relation").
	 * @param ids - The ID storage instance.
	 * @param tags - The tag storage instance.
	 */
	constructor(indexType: OsmEntityType, ids: Ids, tags: Tags) {
		this.indexType = indexType
		this.ids = ids
		this.tags = tags
	}

	/**
	 * Get transferable objects for passing to another thread.
	 */
	transferables(): EntitiesTransferables {
		return {
			...this.ids.transferables(),
			...this.tags.transferables(),
		}
	}

	/**
	 * Check if the index is built and ready for use.
	 */
	isReady() {
		return this.ids.isReady() && this.tags.isReady() && this.indexBuilt
	}

	/** Number of entities in this collection. */
	get size() {
		return this.ids.size
	}

	/**
	 * Compact entity-specific typed arrays.
	 * Called by `buildIndex()` after ID and tag indexes are built.
	 * @abstract
	 */
	abstract buildEntityIndex(): void

	/**
	 * Finalize indexes.
	 * Must be called after adding entities and before querying.
	 */
	buildIndex() {
		if (this.indexBuilt) return
		console.time(`${this.indexType}Index.buildIndex`)
		this.ids.buildIndex()
		this.tags.buildIndex()
		this.buildEntityIndex()
		this.indexBuilt = true
		console.timeEnd(`${this.indexType}Index.buildIndex`)
	}

	/**
	 * Get the bounding box of an entity.
	 * @param idOrIndex - Entity identifier (by ID or internal index).
	 * @returns Geographic bounding box [minLon, minLat, maxLon, maxLat].
	 * @abstract
	 */
	abstract getEntityBbox(idOrIndex: IdOrIndex): GeoBbox2D

	/**
	 * Reconstruct a full entity object from index data.
	 * @param index - Internal array index.
	 * @param id - OSM entity ID.
	 * @param tags - Optional pre-fetched tags.
	 * @returns The complete entity object.
	 * @abstract
	 */
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

	/**
	 * Get an entity by ID or index.
	 */
	get(idOrIndex: IdOrIndex): T | null {
		const [index, id] = this.ids.idOrIndex(idOrIndex)
		if (index === -1) return null
		return this.getFullEntity(index, id, this.tags.getTags(index))
	}

	/**
	 * Get an entity by index.
	 */
	getByIndex(index: number): T {
		return this.getFullEntity(
			index,
			this.ids.at(index),
			this.tags.getTags(index),
		)
	}

	/**
	 * Get multiple entities by their indexes.
	 */
	getEntitiesByIndex(indexes: number[]): T[] {
		const entities: T[] = []
		for (const index of indexes) {
			const entity = this.getByIndex(index)
			if (entity) entities.push(entity)
			else throw Error(`Entity not found at index ${index}`)
		}
		return entities
	}

	/**
	 * Iterate over all entities in the index.
	 */
	*[Symbol.iterator](): Generator<T> {
		for (let i = 0; i < this.size; i++) {
			yield this.getFullEntity(i, this.ids.at(i), this.tags.getTags(i))
		}
	}

	/**
	 * Get an entity by ID.
	 */
	getById(id: number): T | null {
		const index = this.ids.getIndexFromId(id)
		if (index !== -1)
			return this.getFullEntity(index, id, this.tags.getTags(index))
		return null
	}

	/**
	 * Iterate over entities sorted by ID.
	 */
	*sorted(): Generator<T> {
		for (const id of this.ids.sorted) {
			const index = this.ids.getIndexFromId(id)
			if (index === -1) throw Error(`Entity not found at id ${id}`)
			yield this.getFullEntity(index, id, this.tags.getTags(index))
		}
	}

	/**
	 * Search for entities with a specific tag key and optional value.
	 */
	search(key: string, val?: string): T[] {
		const keyIndex = this.tags.find(key)
		const entities = this.tags
			.hasKey(keyIndex)
			.map((index) => this.getByIndex(index))
		if (val === undefined) return entities
		return entities.filter((entity) => entity.tags?.[key] === val)
	}
}
