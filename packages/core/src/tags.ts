/**
 * Tag storage and lookup.
 *
 * Stores key=value pairs using string table indices. Supports:
 * 1. **Entity → Tags**: Retrieve tags for a given entity.
 * 2. **Key → Entities**: Find entities with a specific tag key.
 *
 * @module
 */

import type { ContentHasher } from "@osmix/shared/content-hasher"
import type { OsmTags } from "@osmix/shared/types"
import StringTable from "./stringtable"
import { type BufferType, ResizeableTypedArray as RTA } from "./typed-arrays"

/**
 * Serializable state for worker transfer.
 */
export interface TagsTransferables<T extends BufferType = BufferType> {
	/** Maps entity index → start position in tagKeys/tagVals. */
	tagStart: T
	/** Maps entity index → number of tags. */
	tagCount: T
	/** Flattened tag key indices. */
	tagKeys: T
	/** Flattened tag value indices. */
	tagVals: T

	/** Flattened entity indices for reverse key lookup. */
	keyEntities: T
	/** Maps key index → start position in keyEntities. */
	keyIndexStart: T
	/** Maps key index → count of entities with that key. */
	keyIndexCount: T
}

/**
 * Bidirectional tag storage.
 *
 * Limits: Max 255 tags per entity.
 * Note: String indices reference a shared `StringTable`.
 */
export class Tags {
	/** Reference to the shared string table for key/value storage */
	private stringTable: StringTable = new StringTable()

	// ─── Entity → Tag Lookup ───────────────────────────────────────────────────
	/** Maps entity index → start position in tagKeys/tagVals */
	private tagStart: RTA<Uint32Array>
	/** Maps entity index → number of tags (max 255) */
	private tagCount: RTA<Uint8Array>
	/** All tag key string indices, concatenated */
	private tagKeys: RTA<Uint32Array>
	/** All tag value string indices, concatenated (parallel to tagKeys) */
	private tagVals: RTA<Uint32Array>

	// ─── Key → Entity Reverse Lookup ───────────────────────────────────────────
	/**
	 * Flattened array of entity indices that have each tag key.
	 * Indexed via keyIndexStart and keyIndexCount.
	 */
	private keyEntities: RTA<Uint32Array>

	/** Maps key string index → start position in keyEntities */
	private keyIndexStart: RTA<Uint32Array>
	/** Maps key string index → count of entities with that key */
	private keyIndexCount: RTA<Uint32Array>

	/**
	 * Temporary map used during ingestion to collect entity indices per key.
	 * Converted to flat arrays during buildIndex() and then cleared.
	 */
	private keyEntityIndexBuilder = new Map<number, number[]>()

	/** Whether buildIndex() has been called */
	private indexBuilt = false

	/**
	 * Create a new Tags index.
	 */
	constructor(stringTable: StringTable, transferables?: TagsTransferables) {
		this.stringTable = stringTable
		if (transferables) {
			this.tagStart = RTA.from(Uint32Array, transferables.tagStart)
			this.tagCount = RTA.from(Uint8Array, transferables.tagCount)
			this.tagKeys = RTA.from(Uint32Array, transferables.tagKeys)
			this.tagVals = RTA.from(Uint32Array, transferables.tagVals)
			this.keyEntities = RTA.from(Uint32Array, transferables.keyEntities)
			this.keyIndexStart = RTA.from(Uint32Array, transferables.keyIndexStart)
			this.keyIndexCount = RTA.from(Uint32Array, transferables.keyIndexCount)
			this.indexBuilt = true
		} else {
			this.tagStart = new RTA(Uint32Array)
			this.tagCount = new RTA(Uint8Array)
			this.tagKeys = new RTA(Uint32Array)
			this.tagVals = new RTA(Uint32Array)
			this.keyEntities = new RTA(Uint32Array)
			this.keyIndexStart = new RTA(Uint32Array)
			this.keyIndexCount = new RTA(Uint32Array)
		}
	}

	/**
	 * Add tags to an entity.
	 */
	addTags(index: number, tags?: OsmTags): [number[], number[]] {
		const tagKeys: number[] = []
		const tagValues: number[] = []

		if (tags) {
			for (const [key, value] of Object.entries(tags)) {
				tagKeys.push(this.stringTable.add(key))
				tagValues.push(this.stringTable.add(String(value)))
			}
		}

		this.addTagKeysAndValues(index, tagKeys, tagValues)

		return [tagKeys, tagValues]
	}

	/**
	 * Add tags to an entity using key and value indexes.
	 */
	addTagKeysAndValues(index: number, keys: number[], values: number[]) {
		this.tagStart.set(index, this.tagKeys.length)
		this.tagCount.set(index, keys.length)
		this.tagKeys.pushMany(keys)
		this.tagVals.pushMany(values)

		keys.forEach((key) => {
			const keyEntities = this.keyEntityIndexBuilder.get(key)
			if (keyEntities) {
				keyEntities.push(index)
			} else {
				this.keyEntityIndexBuilder.set(key, [index])
			}
		})
	}

	/**
	 * Finalize the tag index.
	 *
	 * Compacts arrays and builds the reverse key→entity index.
	 * Must be called before `hasKey()`.
	 */
	buildIndex() {
		this.tagStart.compact()
		this.tagCount.compact()
		this.tagKeys.compact()
		this.tagVals.compact()

		// Convert the builder map to flat arrays for the reverse index
		for (const [keyIndex, entityIndexes] of this.keyEntityIndexBuilder) {
			this.keyIndexStart.set(keyIndex, this.keyEntities.length)
			this.keyIndexCount.set(keyIndex, entityIndexes.length)
			this.keyEntities.pushMany(entityIndexes)
		}

		this.keyIndexStart.compact()
		this.keyIndexCount.compact()
		this.keyEntityIndexBuilder.clear()

		this.indexBuilt = true
	}

	/**
	 * Check if the index is built and ready for use.
	 */
	isReady() {
		return this.indexBuilt
	}

	/**
	 * Get the number of tags for an entity.
	 */
	cardinality(index: number): number {
		return this.tagCount.at(index) ?? 0
	}

	/**
	 * Get the tags for an entity.
	 */
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

	/**
	 * Get tags from key and value indexes.
	 */
	getTagsFromIndices(keys: number[], values: number[]): OsmTags {
		const tags: OsmTags = {}
		for (let i = 0; i < keys.length; i++) {
			const keyIndex = keys[i]
			const valIndex = values[i]
			if (keyIndex === undefined || valIndex === undefined)
				throw Error("Tag key or value not found")
			tags[this.stringTable.get(keyIndex)] = this.stringTable.get(valIndex)
		}
		return tags
	}

	/**
	 * Find the index of a tag key.
	 */
	find(key: string): number {
		return this.stringTable.find(key)
	}

	/**
	 * Get all entity indexes that have a specific tag key.
	 */
	hasKey(keyIndex: number): number[] {
		if (keyIndex < 0) return []
		const start = this.keyIndexStart.at(keyIndex) ?? 0
		const count = this.keyIndexCount.at(keyIndex) ?? 0
		return Array.from(this.keyEntities.array.subarray(start, start + count))
	}

	/**
	 * Create a unique composite index for a key=value pair.
	 * Uses row-major indexing: `key * width + val`.
	 */
	kvToIndex(key: number, val: number) {
		const width = this.stringTable.length
		return key * width + val
	}

	/**
	 * Get transferable objects for passing to another thread.
	 */
	transferables(): TagsTransferables {
		return {
			tagStart: this.tagStart.array.buffer,
			tagCount: this.tagCount.array.buffer,
			tagKeys: this.tagKeys.array.buffer,
			tagVals: this.tagVals.array.buffer,
			keyEntities: this.keyEntities.array.buffer,
			keyIndexStart: this.keyIndexStart.array.buffer,
			keyIndexCount: this.keyIndexCount.array.buffer,
		}
	}

	/**
	 * Get the approximate memory requirements for a given number of tags in bytes.
	 */
	static getBytesRequired(count: number) {
		return (
			count * Uint32Array.BYTES_PER_ELEMENT + // tagStart
			count * Uint8Array.BYTES_PER_ELEMENT // tagCount
		)
	}

	/**
	 * Reconstruct a Tags index from transferable objects.
	 */
	static fromTransferables(
		stringTable: StringTable,
		transferables: TagsTransferables,
	) {
		const tagIndex = new Tags(stringTable, transferables)
		tagIndex.indexBuilt = true
		return tagIndex
	}

	/**
	 * Update a ContentHasher with the tags data.
	 * Hashes tag keys and values for each entity.
	 */
	updateHash(hasher: ContentHasher): ContentHasher {
		return hasher
			.update(this.tagStart.array)
			.update(this.tagCount.array)
			.update(this.tagKeys.array)
			.update(this.tagVals.array)
	}
}
