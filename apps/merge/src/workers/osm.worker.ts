/**
 * Extended OsmixWorker with IndexedDB storage capabilities.
 *
 * Handles file hashing, storage, and retrieval in the worker thread
 * to keep the main UI responsive. Uses BroadcastChannel to notify
 * the main thread of storage changes.
 */

import type { OsmInfo, OsmTransferables } from "@osmix/core"
import { Osm } from "@osmix/core"
import { expose } from "comlink"
import { type DBSchema, type IDBPDatabase, openDB } from "idb"
import { OsmixWorker } from "osmix"
import { DB_NAME, DB_VERSION, OSM_STORE, STORAGE_CHANNEL } from "../settings"

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

/**
 * Extended worker with IndexedDB storage capabilities.
 * All heavy operations (hashing, storage, loading) run off the main thread.
 */
export class MergeWorker extends OsmixWorker {
	private dbPromise: Promise<IDBPDatabase<OsmixDB>> | null = null
	private broadcastChannel = new BroadcastChannel(STORAGE_CHANNEL)

	constructor() {
		super()
		this.broadcastChannel.addEventListener("message", (event) => {
			if (event.data.type === "delete") {
				this.delete(event.data.id)
			}
		})
	}

	private async getDB(): Promise<IDBPDatabase<OsmixDB>> {
		if (!this.dbPromise) {
			this.dbPromise = openDB<OsmixDB>(DB_NAME, DB_VERSION, {
				upgrade(db) {
					const store = db.createObjectStore(OSM_STORE, { keyPath: "fileHash" })
					store.createIndex("by-stored-at", "storedAt")
					store.createIndex("by-hash", "fileHash")
				},
			})
		}
		return this.dbPromise
	}

	/** Notify main thread of storage changes via BroadcastChannel */
	private notifyStorageChange() {
		this.broadcastChannel.postMessage({ type: "storage-changed" })
	}

	/**
	 * Compute SHA-256 hash of an ArrayBuffer and return as hex string.
	 */
	async hashBuffer(data: ArrayBuffer): Promise<string> {
		const digest = await crypto.subtle.digest("SHA-256", data)
		return Array.from(new Uint8Array(digest))
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("")
	}

	/**
	 * Find a stored entry by file hash.
	 * Returns the stored entry metadata if found, null otherwise.
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
	 * Store the currently-loaded Osm instance to IndexedDB.
	 * The Osm must already be registered in the worker via fromPbf or similar.
	 */
	async storeCurrentOsm(
		osmId: string,
		fileInfo: StoredFileInfo,
	): Promise<void> {
		const osm = this.get(osmId)
		const transferables = osm.transferables()
		const info = osm.info()
		const db = await this.getDB()

		await db.put(OSM_STORE, {
			...toStorableTransferables(transferables),
			info,
			storedAt: Date.now(),
			fileHash: fileInfo.fileHash,
			fileName: fileInfo.fileName,
			fileSize: fileInfo.fileSize,
		})
		this.notifyStorageChange()
	}

	/**
	 * Load an Osm from IndexedDB by storage ID and register it in this worker.
	 * Builds spatial indexes automatically after loading.
	 * Returns the OsmInfo if found, null otherwise.
	 */
	async loadFromStorage(storageId: string): Promise<{
		entry: StoredOsmEntry
		info: OsmInfo
	} | null> {
		const db = await this.getDB()
		const stored = await db.get(OSM_STORE, storageId)
		if (!stored) return null

		// Convert from storage format and reconstruct Osm
		const transferables = fromStorableTransferables(stored)
		const osm = new Osm(transferables)
		osm.buildSpatialIndexes()

		// Register in worker (this also creates VT encoder and rebuilds routing graph if exists)
		this.set(stored.fileHash, osm)

		return {
			entry: {
				info: stored.info,
				storedAt: stored.storedAt,
				fileHash: stored.fileHash,
				fileName: stored.fileName,
				fileSize: stored.fileSize,
			},
			info: stored.info,
		}
	}

	/**
	 * Get all stored Osm entries (metadata only, not the full transferables).
	 */
	async listStoredOsm(): Promise<StoredOsmEntry[]> {
		const db = await this.getDB()
		const all = await db.getAll(OSM_STORE)
		return all.map((stored) => ({
			info: stored.info,
			storedAt: stored.storedAt,
			fileHash: stored.fileHash,
			fileName: stored.fileName,
			fileSize: stored.fileSize,
		}))
	}

	/**
	 * Delete a stored Osm entry from IndexedDB.
	 */
	async deleteStoredOsm(id: string): Promise<void> {
		const db = await this.getDB()
		await db.delete(OSM_STORE, id)
		this.delete(id)
		this.broadcastChannel.postMessage({ type: "delete", id })
		this.notifyStorageChange()
	}

	/**
	 * Get storage statistics.
	 */
	async getStorageStats(): Promise<{ count: number; estimatedBytes: number }> {
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

// ---------------------------------------------------------------------------
// Helper functions for converting transferables to/from storable format
// ---------------------------------------------------------------------------

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
 * Convert an ArrayBuffer to a SharedArrayBuffer, for use in workers.
 */
function toSharedArrayBuffer(buffer: ArrayBuffer): SharedArrayBuffer {
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
			ids: toArrayBuffer(t.nodes.ids),
			sortedIds: toArrayBuffer(t.nodes.sortedIds),
			sortedIdPositionToIndex: toArrayBuffer(t.nodes.sortedIdPositionToIndex),
			anchors: toArrayBuffer(t.nodes.anchors),
			idsAreSorted: t.nodes.idsAreSorted,
			tagStart: toArrayBuffer(t.nodes.tagStart),
			tagCount: toArrayBuffer(t.nodes.tagCount),
			tagKeys: toArrayBuffer(t.nodes.tagKeys),
			tagVals: toArrayBuffer(t.nodes.tagVals),
			keyEntities: toArrayBuffer(t.nodes.keyEntities),
			keyIndexStart: toArrayBuffer(t.nodes.keyIndexStart),
			keyIndexCount: toArrayBuffer(t.nodes.keyIndexCount),
			lons: toArrayBuffer(t.nodes.lons),
			lats: toArrayBuffer(t.nodes.lats),
			bbox: t.nodes.bbox,
		},
		ways: {
			ids: toArrayBuffer(t.ways.ids),
			sortedIds: toArrayBuffer(t.ways.sortedIds),
			sortedIdPositionToIndex: toArrayBuffer(t.ways.sortedIdPositionToIndex),
			anchors: toArrayBuffer(t.ways.anchors),
			idsAreSorted: t.ways.idsAreSorted,
			tagStart: toArrayBuffer(t.ways.tagStart),
			tagCount: toArrayBuffer(t.ways.tagCount),
			tagKeys: toArrayBuffer(t.ways.tagKeys),
			tagVals: toArrayBuffer(t.ways.tagVals),
			keyEntities: toArrayBuffer(t.ways.keyEntities),
			keyIndexStart: toArrayBuffer(t.ways.keyIndexStart),
			keyIndexCount: toArrayBuffer(t.ways.keyIndexCount),
			refStart: toArrayBuffer(t.ways.refStart),
			refCount: toArrayBuffer(t.ways.refCount),
			refs: toArrayBuffer(t.ways.refs),
			bbox: toArrayBuffer(t.ways.bbox),
		},
		relations: {
			ids: toArrayBuffer(t.relations.ids),
			sortedIds: toArrayBuffer(t.relations.sortedIds),
			sortedIdPositionToIndex: toArrayBuffer(
				t.relations.sortedIdPositionToIndex,
			),
			anchors: toArrayBuffer(t.relations.anchors),
			idsAreSorted: t.relations.idsAreSorted,
			tagStart: toArrayBuffer(t.relations.tagStart),
			tagCount: toArrayBuffer(t.relations.tagCount),
			tagKeys: toArrayBuffer(t.relations.tagKeys),
			tagVals: toArrayBuffer(t.relations.tagVals),
			keyEntities: toArrayBuffer(t.relations.keyEntities),
			keyIndexStart: toArrayBuffer(t.relations.keyIndexStart),
			keyIndexCount: toArrayBuffer(t.relations.keyIndexCount),
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
			ids: toSharedArrayBuffer(t.nodes.ids),
			sortedIds: toSharedArrayBuffer(t.nodes.sortedIds),
			sortedIdPositionToIndex: toSharedArrayBuffer(
				t.nodes.sortedIdPositionToIndex,
			),
			anchors: toSharedArrayBuffer(t.nodes.anchors),
			idsAreSorted: t.nodes.idsAreSorted,
			tagStart: toSharedArrayBuffer(t.nodes.tagStart),
			tagCount: toSharedArrayBuffer(t.nodes.tagCount),
			tagKeys: toSharedArrayBuffer(t.nodes.tagKeys),
			tagVals: toSharedArrayBuffer(t.nodes.tagVals),
			keyEntities: toSharedArrayBuffer(t.nodes.keyEntities),
			keyIndexStart: toSharedArrayBuffer(t.nodes.keyIndexStart),
			keyIndexCount: toSharedArrayBuffer(t.nodes.keyIndexCount),
			lons: toSharedArrayBuffer(t.nodes.lons),
			lats: toSharedArrayBuffer(t.nodes.lats),
			bbox: t.nodes.bbox,
		},
		ways: {
			ids: toSharedArrayBuffer(t.ways.ids),
			sortedIds: toSharedArrayBuffer(t.ways.sortedIds),
			sortedIdPositionToIndex: toSharedArrayBuffer(
				t.ways.sortedIdPositionToIndex,
			),
			anchors: toSharedArrayBuffer(t.ways.anchors),
			idsAreSorted: t.ways.idsAreSorted,
			tagStart: toSharedArrayBuffer(t.ways.tagStart),
			tagCount: toSharedArrayBuffer(t.ways.tagCount),
			tagKeys: toSharedArrayBuffer(t.ways.tagKeys),
			tagVals: toSharedArrayBuffer(t.ways.tagVals),
			keyEntities: toSharedArrayBuffer(t.ways.keyEntities),
			keyIndexStart: toSharedArrayBuffer(t.ways.keyIndexStart),
			keyIndexCount: toSharedArrayBuffer(t.ways.keyIndexCount),
			refStart: toSharedArrayBuffer(t.ways.refStart),
			refCount: toSharedArrayBuffer(t.ways.refCount),
			refs: toSharedArrayBuffer(t.ways.refs),
			bbox: toSharedArrayBuffer(t.ways.bbox),
		},
		relations: {
			ids: toSharedArrayBuffer(t.relations.ids),
			sortedIds: toSharedArrayBuffer(t.relations.sortedIds),
			sortedIdPositionToIndex: toSharedArrayBuffer(
				t.relations.sortedIdPositionToIndex,
			),
			anchors: toSharedArrayBuffer(t.relations.anchors),
			idsAreSorted: t.relations.idsAreSorted,
			tagStart: toSharedArrayBuffer(t.relations.tagStart),
			tagCount: toSharedArrayBuffer(t.relations.tagCount),
			tagKeys: toSharedArrayBuffer(t.relations.tagKeys),
			tagVals: toSharedArrayBuffer(t.relations.tagVals),
			keyEntities: toSharedArrayBuffer(t.relations.keyEntities),
			keyIndexStart: toSharedArrayBuffer(t.relations.keyIndexStart),
			keyIndexCount: toSharedArrayBuffer(t.relations.keyIndexCount),
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
 * Collect all ArrayBuffer objects from a structure for size estimation.
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

expose(new MergeWorker())
