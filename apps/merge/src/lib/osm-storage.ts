/**
 * IndexedDB storage for Osm transferables using the idb library.
 *
 * Stores `OsmTransferables` so they can be reloaded without re-parsing PBF files,
 * similar to how they're transferred across WebWorkers.
 *
 * Features:
 * - Stores file hash to detect duplicates and avoid re-parsing
 * - Converts SharedArrayBuffer to regular ArrayBuffer (IndexedDB requirement)
 */

import type { OsmInfo, OsmTransferables } from "@osmix/core"
import { concatBytes } from "@osmix/shared/concat-bytes"
import { type DBSchema, type IDBPDatabase, openDB } from "idb"
import { DB_NAME, DB_VERSION, OSM_STORE } from "../settings"
import browserHash from "./browser-hash"

/** File metadata stored alongside Osm data */
export interface StoredFileInfo {
	fileHash: string
	fileName: string
	fileSize: number
}

export interface StoredOsmEntry extends StoredFileInfo {
	info: OsmInfo
	storedAt: number
}

export interface StoredOsm
	extends StoredOsmEntry,
		OsmTransferables<ArrayBuffer> {}

interface OsmixDB extends DBSchema {
	[OSM_STORE]: {
		key: string
		value: StoredOsm
		indexes: {
			"by-stored-at": number
			"by-hash": string
		}
	}
}

class OsmStorage {
	listeners = new Set<() => void>()
	dbPromise: Promise<IDBPDatabase<OsmixDB>> | null = null
	snapshot = {
		entries: [] as StoredOsmEntry[],
		loading: false,
		estimatedBytes: 0,
	}

	async getDB(): Promise<IDBPDatabase<OsmixDB>> {
		if (!this.dbPromise) {
			this.dbPromise = openDB<OsmixDB>(DB_NAME, DB_VERSION, {
				upgrade(db) {
					const store = db.createObjectStore(OSM_STORE, { keyPath: "fileHash" })
					store.createIndex("by-stored-at", "storedAt")
					store.createIndex("by-hash", "fileHash")
				},
			})
			await this.dbPromise
			await this.refresh()
		}
		return this.dbPromise
	}

	subscribe = (fn: () => void) => {
		this.listeners.add(fn)
		return () => {
			this.listeners.delete(fn)
		}
	}

	getSnapshot = () => {
		return this.snapshot
	}

	async refresh() {
		const entries = await this.listStoredOsm()

		let estimatedBytes = 0
		for (const t of entries) {
			estimatedBytes += collectBuffers(t).reduce(
				(acc, buffer) => acc + buffer.byteLength,
				0,
			)
		}
		this.snapshot = {
			entries,
			estimatedBytes,
			loading: false,
		}
		for (const fn of this.listeners) {
			console.log("calling listener", fn)
			fn()
		}
	}

	/**
	 * Find a stored entry by file hash.
	 * Returns the stored entry if found, null otherwise.
	 */
	async findByHash(hash: string): Promise<StoredOsmEntry | null> {
		const db = await this.getDB()
		const stored = await db.getFromIndex(OSM_STORE, "by-hash", hash)
		if (!stored) return null
		return {
			info: stored.info,
			storedAt: stored.storedAt,
			fileHash: stored.fileHash,
			fileName: stored.fileName,
			fileSize: stored.fileSize,
		}
	}

	/**
	 * Store an Osm instance's transferables in IndexedDB.
	 * @param info - The OsmInfo metadata
	 * @param transferables - The Osm transferables to store
	 * @param options - Optional storage options
	 */
	async storeOsm(
		info: OsmInfo,
		transferables: OsmTransferables,
		fileInfo: StoredFileInfo,
	): Promise<void> {
		const db = await this.getDB()
		await db.put(OSM_STORE, {
			...toStorableTransferables(transferables),
			info,
			storedAt: Date.now(),
			fileHash: fileInfo.fileHash,
			fileName: fileInfo.fileName,
			fileSize: fileInfo.fileSize,
		})
		await this.refresh()
	}

	/**
	 * Load Osm transferables from IndexedDB.
	 */
	async loadOsmTransferables(id: string): Promise<OsmTransferables | null> {
		const db = await this.getDB()
		const stored = await db.get(OSM_STORE, id)
		if (!stored) return null
		return fromStorableTransferables(stored)
	}

	/**
	 * Load a stored Osm entry from IndexedDB.
	 * Returns the info and transferables in the proper OsmTransferables format.
	 */
	async loadStoredOsm(id: string): Promise<{
		entry: StoredOsmEntry
		transferables: OsmTransferables<SharedArrayBuffer>
	} | null> {
		const db = await this.getDB()
		const stored = await db.get(OSM_STORE, id)
		if (!stored) return null
		return {
			entry: {
				info: stored.info,
				storedAt: stored.storedAt,
				fileHash: stored.fileHash,
				fileName: stored.fileName,
				fileSize: stored.fileSize,
			},
			transferables: fromStorableTransferables(stored),
		}
	}

	/**
	 * Get all stored Osm entries (without the full transferables for listing).
	 */
	async listStoredOsm(): Promise<StoredOsm[]> {
		const db = await this.getDB()
		return db.getAll(OSM_STORE)
	}

	/**
	 * Delete a stored Osm entry from IndexedDB.
	 */
	async deleteStoredOsm(id: string): Promise<void> {
		const db = await this.getDB()
		await db.delete(OSM_STORE, id)
		await this.refresh()
	}

	/**
	 * Clear all stored Osm entries from IndexedDB.
	 */
	async clearStoredOsm(): Promise<void> {
		const db = await this.getDB()
		await db.clear(OSM_STORE)
		await this.refresh()
	}

	/**
	 * Check if an Osm entry exists in IndexedDB.
	 */
	async hasStoredOsm(id: string): Promise<boolean> {
		const db = await this.getDB()
		const count = await db.count(OSM_STORE, id)
		return count > 0
	}

	/**
	 * Get the approximate storage size of stored Osm data.
	 */
	async getStorageStats(): Promise<{
		count: number
		estimatedBytes: number
	}> {
		const db = await this.getDB()
		const all = await db.getAll(OSM_STORE)
		let estimatedBytes = 0
		for (const t of all) {
			estimatedBytes += collectBuffers(t).reduce(
				(acc, buffer) => acc + buffer.byteLength,
				0,
			)
		}
		return { count: all.length, estimatedBytes }
	}
}

export const osmStorage = new OsmStorage()

/**
 * Compute SHA-256 hash of a file and return as hex string.
 */
export async function hashFile(file: File): Promise<string> {
	const buffer = await file.arrayBuffer()
	return browserHash(buffer)
}

/**
 * Compute a SHA-256 hash of OsmTransferable ArrayBuffers.
 */
export async function hashOsmTransferables(
	t: OsmTransferables,
): Promise<string> {
	const buffers = collectBuffers(t)
	const digests = await Promise.all(
		buffers.map(
			async (buffer) =>
				new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
		),
	)

	return browserHash(concatBytes(digests).buffer)
}

/**
 * Convert a buffer (possibly SharedArrayBuffer) to a regular ArrayBuffer.
 * IndexedDB cannot store SharedArrayBuffer, so we need to copy the data.
 */
function toArrayBuffer(
	buffer: ArrayBuffer | SharedArrayBuffer | ArrayBufferLike,
): ArrayBuffer {
	if (buffer instanceof ArrayBuffer) {
		return buffer
	}
	// Copy SharedArrayBuffer to ArrayBuffer
	const copy = new ArrayBuffer(buffer.byteLength)
	new Uint8Array(copy).set(new Uint8Array(buffer))
	return copy
}

/**
 * Convert an ArrayBuffer to a SharedArrayBuffer, for copying to workers.
 */
function toSharedArrayBuffer(buffer: ArrayBuffer): SharedArrayBuffer {
	// Copy SharedArrayBuffer to ArrayBuffer
	const copy = new SharedArrayBuffer(buffer.byteLength)
	new Uint8Array(copy).set(new Uint8Array(buffer))
	return copy
}

/**
 * Convert OsmTransferables to a storable format with regular ArrayBuffers.
 * Spatial indexes are excluded since they can be rebuilt from the data.
 */
function toStorableTransferables(
	t: OsmTransferables,
): OsmTransferables<ArrayBuffer> {
	return {
		id: t.id,
		header: t.header,
		stringTable: {
			bytes: toArrayBuffer(t.stringTable.bytes),
			start: toArrayBuffer(t.stringTable.start),
			count: toArrayBuffer(t.stringTable.count),
		},
		nodes: {
			// IdsTransferables
			ids: toArrayBuffer(t.nodes.ids),
			sortedIds: toArrayBuffer(t.nodes.sortedIds),
			sortedIdPositionToIndex: toArrayBuffer(t.nodes.sortedIdPositionToIndex),
			anchors: toArrayBuffer(t.nodes.anchors),
			idsAreSorted: t.nodes.idsAreSorted,
			// TagsTransferables
			tagStart: toArrayBuffer(t.nodes.tagStart),
			tagCount: toArrayBuffer(t.nodes.tagCount),
			tagKeys: toArrayBuffer(t.nodes.tagKeys),
			tagVals: toArrayBuffer(t.nodes.tagVals),
			keyEntities: toArrayBuffer(t.nodes.keyEntities),
			keyIndexStart: toArrayBuffer(t.nodes.keyIndexStart),
			keyIndexCount: toArrayBuffer(t.nodes.keyIndexCount),
			// NodesTransferables (spatialIndex excluded - rebuilt on load)
			lons: toArrayBuffer(t.nodes.lons),
			lats: toArrayBuffer(t.nodes.lats),
			bbox: t.nodes.bbox,
		},
		ways: {
			// IdsTransferables
			ids: toArrayBuffer(t.ways.ids),
			sortedIds: toArrayBuffer(t.ways.sortedIds),
			sortedIdPositionToIndex: toArrayBuffer(t.ways.sortedIdPositionToIndex),
			anchors: toArrayBuffer(t.ways.anchors),
			idsAreSorted: t.ways.idsAreSorted,
			// TagsTransferables
			tagStart: toArrayBuffer(t.ways.tagStart),
			tagCount: toArrayBuffer(t.ways.tagCount),
			tagKeys: toArrayBuffer(t.ways.tagKeys),
			tagVals: toArrayBuffer(t.ways.tagVals),
			keyEntities: toArrayBuffer(t.ways.keyEntities),
			keyIndexStart: toArrayBuffer(t.ways.keyIndexStart),
			keyIndexCount: toArrayBuffer(t.ways.keyIndexCount),
			// WaysTransferables (spatialIndex excluded - rebuilt on load)
			refStart: toArrayBuffer(t.ways.refStart),
			refCount: toArrayBuffer(t.ways.refCount),
			refs: toArrayBuffer(t.ways.refs),
			bbox: toArrayBuffer(t.ways.bbox),
		},
		relations: {
			// IdsTransferables
			ids: toArrayBuffer(t.relations.ids),
			sortedIds: toArrayBuffer(t.relations.sortedIds),
			sortedIdPositionToIndex: toArrayBuffer(
				t.relations.sortedIdPositionToIndex,
			),
			anchors: toArrayBuffer(t.relations.anchors),
			idsAreSorted: t.relations.idsAreSorted,
			// TagsTransferables
			tagStart: toArrayBuffer(t.relations.tagStart),
			tagCount: toArrayBuffer(t.relations.tagCount),
			tagKeys: toArrayBuffer(t.relations.tagKeys),
			tagVals: toArrayBuffer(t.relations.tagVals),
			keyEntities: toArrayBuffer(t.relations.keyEntities),
			keyIndexStart: toArrayBuffer(t.relations.keyIndexStart),
			keyIndexCount: toArrayBuffer(t.relations.keyIndexCount),
			// RelationsTransferables (spatialIndex excluded - rebuilt on load)
			memberStart: toArrayBuffer(t.relations.memberStart),
			memberCount: toArrayBuffer(t.relations.memberCount),
			memberRefs: toArrayBuffer(t.relations.memberRefs),
			memberTypes: toArrayBuffer(t.relations.memberTypes),
			memberRoles: toArrayBuffer(t.relations.memberRoles),
			bbox: toArrayBuffer(t.relations.bbox),
		},
	}
}

/**
 * Convert stored OsmTransferables back to SharedArrayBuffers for use in workers.
 * Spatial indexes are not included since they will be rebuilt on load.
 */
function fromStorableTransferables(
	t: OsmTransferables<ArrayBuffer>,
): OsmTransferables<SharedArrayBuffer> {
	return {
		id: t.id,
		header: t.header,
		stringTable: {
			bytes: toSharedArrayBuffer(t.stringTable.bytes),
			start: toSharedArrayBuffer(t.stringTable.start),
			count: toSharedArrayBuffer(t.stringTable.count),
		},
		nodes: {
			// IdsTransferables
			ids: toSharedArrayBuffer(t.nodes.ids),
			sortedIds: toSharedArrayBuffer(t.nodes.sortedIds),
			sortedIdPositionToIndex: toSharedArrayBuffer(
				t.nodes.sortedIdPositionToIndex,
			),
			anchors: toSharedArrayBuffer(t.nodes.anchors),
			idsAreSorted: t.nodes.idsAreSorted,
			// TagsTransferables
			tagStart: toSharedArrayBuffer(t.nodes.tagStart),
			tagCount: toSharedArrayBuffer(t.nodes.tagCount),
			tagKeys: toSharedArrayBuffer(t.nodes.tagKeys),
			tagVals: toSharedArrayBuffer(t.nodes.tagVals),
			keyEntities: toSharedArrayBuffer(t.nodes.keyEntities),
			keyIndexStart: toSharedArrayBuffer(t.nodes.keyIndexStart),
			keyIndexCount: toSharedArrayBuffer(t.nodes.keyIndexCount),
			// NodesTransferables (spatialIndex excluded - rebuilt on load)
			lons: toSharedArrayBuffer(t.nodes.lons),
			lats: toSharedArrayBuffer(t.nodes.lats),
			bbox: t.nodes.bbox,
		},
		ways: {
			// IdsTransferables
			ids: toSharedArrayBuffer(t.ways.ids),
			sortedIds: toSharedArrayBuffer(t.ways.sortedIds),
			sortedIdPositionToIndex: toSharedArrayBuffer(
				t.ways.sortedIdPositionToIndex,
			),
			anchors: toSharedArrayBuffer(t.ways.anchors),
			idsAreSorted: t.ways.idsAreSorted,
			// TagsTransferables
			tagStart: toSharedArrayBuffer(t.ways.tagStart),
			tagCount: toSharedArrayBuffer(t.ways.tagCount),
			tagKeys: toSharedArrayBuffer(t.ways.tagKeys),
			tagVals: toSharedArrayBuffer(t.ways.tagVals),
			keyEntities: toSharedArrayBuffer(t.ways.keyEntities),
			keyIndexStart: toSharedArrayBuffer(t.ways.keyIndexStart),
			keyIndexCount: toSharedArrayBuffer(t.ways.keyIndexCount),
			// WaysTransferables (spatialIndex excluded - rebuilt on load)
			refStart: toSharedArrayBuffer(t.ways.refStart),
			refCount: toSharedArrayBuffer(t.ways.refCount),
			refs: toSharedArrayBuffer(t.ways.refs),
			bbox: toSharedArrayBuffer(t.ways.bbox),
		},
		relations: {
			// IdsTransferables
			ids: toSharedArrayBuffer(t.relations.ids),
			sortedIds: toSharedArrayBuffer(t.relations.sortedIds),
			sortedIdPositionToIndex: toSharedArrayBuffer(
				t.relations.sortedIdPositionToIndex,
			),
			anchors: toSharedArrayBuffer(t.relations.anchors),
			idsAreSorted: t.relations.idsAreSorted,
			// TagsTransferables
			tagStart: toSharedArrayBuffer(t.relations.tagStart),
			tagCount: toSharedArrayBuffer(t.relations.tagCount),
			tagKeys: toSharedArrayBuffer(t.relations.tagKeys),
			tagVals: toSharedArrayBuffer(t.relations.tagVals),
			keyEntities: toSharedArrayBuffer(t.relations.keyEntities),
			keyIndexStart: toSharedArrayBuffer(t.relations.keyIndexStart),
			keyIndexCount: toSharedArrayBuffer(t.relations.keyIndexCount),
			// RelationsTransferables (spatialIndex excluded - rebuilt on load)
			memberStart: toSharedArrayBuffer(t.relations.memberStart),
			memberCount: toSharedArrayBuffer(t.relations.memberCount),
			memberRefs: toSharedArrayBuffer(t.relations.memberRefs),
			memberTypes: toSharedArrayBuffer(t.relations.memberTypes),
			memberRoles: toSharedArrayBuffer(t.relations.memberRoles),
			bbox: toSharedArrayBuffer(t.relations.bbox),
		},
	}
}

/**
 * Collect all ArrayBuffer objects from the transferables for Comlink transfer.
 */
function collectBuffers(t: unknown): ArrayBuffer[] {
	const buffers: ArrayBuffer[] = []
	if (t instanceof ArrayBuffer) return [t]
	if (t != null && typeof t === "object") {
		for (const item of Object.values(t)) {
			buffers.push(...collectBuffers(item))
		}
	}
	return buffers
}
