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
import { openDB, type DBSchema, type IDBPDatabase } from "idb"

const DB_NAME = "osmix-storage"
const DB_VERSION = 2 // Bumped for hash index
const OSM_STORE = "osm"

/**
 * Stored transferables use regular ArrayBuffer (IndexedDB can't store SharedArrayBuffer).
 * Structure mirrors OsmTransferables but with ArrayBuffer instead of BufferType.
 */
type StorableTransferables = {
	id: string
	header: OsmTransferables["header"]
	stringTable: {
		bytes: ArrayBuffer
		start: ArrayBuffer
		count: ArrayBuffer
	}
	nodes: {
		// IdsTransferables
		ids: ArrayBuffer
		sortedIds: ArrayBuffer
		sortedIdPositionToIndex: ArrayBuffer
		anchors: ArrayBuffer
		idsAreSorted: boolean
		// TagsTransferables
		tagStart: ArrayBuffer
		tagCount: ArrayBuffer
		tagKeys: ArrayBuffer
		tagVals: ArrayBuffer
		keyEntities: ArrayBuffer
		keyIndexStart: ArrayBuffer
		keyIndexCount: ArrayBuffer
		// NodesTransferables
		lons: ArrayBuffer
		lats: ArrayBuffer
		bbox: OsmTransferables["nodes"]["bbox"]
		spatialIndex: ArrayBuffer
	}
	ways: {
		// IdsTransferables
		ids: ArrayBuffer
		sortedIds: ArrayBuffer
		sortedIdPositionToIndex: ArrayBuffer
		anchors: ArrayBuffer
		idsAreSorted: boolean
		// TagsTransferables
		tagStart: ArrayBuffer
		tagCount: ArrayBuffer
		tagKeys: ArrayBuffer
		tagVals: ArrayBuffer
		keyEntities: ArrayBuffer
		keyIndexStart: ArrayBuffer
		keyIndexCount: ArrayBuffer
		// WaysTransferables
		refStart: ArrayBuffer
		refCount: ArrayBuffer
		refs: ArrayBuffer
		bbox: ArrayBuffer
		spatialIndex: ArrayBuffer
	}
	relations: {
		// IdsTransferables
		ids: ArrayBuffer
		sortedIds: ArrayBuffer
		sortedIdPositionToIndex: ArrayBuffer
		anchors: ArrayBuffer
		idsAreSorted: boolean
		// TagsTransferables
		tagStart: ArrayBuffer
		tagCount: ArrayBuffer
		tagKeys: ArrayBuffer
		tagVals: ArrayBuffer
		keyEntities: ArrayBuffer
		keyIndexStart: ArrayBuffer
		keyIndexCount: ArrayBuffer
		// RelationsTransferables
		memberStart: ArrayBuffer
		memberCount: ArrayBuffer
		memberRefs: ArrayBuffer
		memberTypes: ArrayBuffer
		memberRoles: ArrayBuffer
		bbox: ArrayBuffer
		spatialIndex: ArrayBuffer
	}
}

export interface StoredOsm {
	id: string
	info: OsmInfo
	transferables: StorableTransferables
	storedAt: number
	/** SHA-256 hash of the original file content */
	fileHash?: string
}

export interface StoredOsmEntry {
	id: string
	info: OsmInfo
	storedAt: number
	fileHash?: string
}

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

let dbPromise: Promise<IDBPDatabase<OsmixDB>> | null = null

function getDB(): Promise<IDBPDatabase<OsmixDB>> {
	if (!dbPromise) {
		dbPromise = openDB<OsmixDB>(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion, _newVersion, transaction) {
				if (oldVersion < 1) {
					const store = db.createObjectStore(OSM_STORE, { keyPath: "id" })
					store.createIndex("by-stored-at", "storedAt")
					store.createIndex("by-hash", "fileHash")
				} else if (oldVersion < 2) {
					// Add hash index to existing store
					const store = transaction.objectStore(OSM_STORE)
					if (!store.indexNames.contains("by-hash")) {
						store.createIndex("by-hash", "fileHash")
					}
				}
			},
		})
	}
	return dbPromise
}

/**
 * Compute SHA-256 hash of a file and return as hex string.
 */
export async function hashFile(file: File): Promise<string> {
	const buffer = await file.arrayBuffer()
	const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
	const hashArray = new Uint8Array(hashBuffer)
	return Array.from(hashArray)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
}

/**
 * Find a stored entry by file hash.
 * Returns the stored entry if found, null otherwise.
 */
export async function findByHash(hash: string): Promise<StoredOsmEntry | null> {
	const db = await getDB()
	const stored = await db.getFromIndex(OSM_STORE, "by-hash", hash)
	if (!stored) return null
	return {
		id: stored.id,
		info: stored.info,
		storedAt: stored.storedAt,
		fileHash: stored.fileHash,
	}
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
 * Convert OsmTransferables to a storable format with regular ArrayBuffers.
 */
function toStorableTransferables(t: OsmTransferables): StorableTransferables {
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
			// NodesTransferables
			lons: toArrayBuffer(t.nodes.lons),
			lats: toArrayBuffer(t.nodes.lats),
			bbox: t.nodes.bbox,
			spatialIndex: toArrayBuffer(t.nodes.spatialIndex),
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
			// WaysTransferables
			refStart: toArrayBuffer(t.ways.refStart),
			refCount: toArrayBuffer(t.ways.refCount),
			refs: toArrayBuffer(t.ways.refs),
			bbox: toArrayBuffer(t.ways.bbox),
			spatialIndex: toArrayBuffer(t.ways.spatialIndex),
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
			// RelationsTransferables
			memberStart: toArrayBuffer(t.relations.memberStart),
			memberCount: toArrayBuffer(t.relations.memberCount),
			memberRefs: toArrayBuffer(t.relations.memberRefs),
			memberTypes: toArrayBuffer(t.relations.memberTypes),
			memberRoles: toArrayBuffer(t.relations.memberRoles),
			bbox: toArrayBuffer(t.relations.bbox),
			spatialIndex: toArrayBuffer(t.relations.spatialIndex),
		},
	}
}

/**
 * Convert stored transferables back to OsmTransferables format.
 * The stored ArrayBuffers are compatible with the OsmTransferables interface.
 */
function fromStorableTransferables(t: StorableTransferables): OsmTransferables {
	// ArrayBuffer is assignable to BufferType, so we can cast directly
	return t as unknown as OsmTransferables
}

/**
 * Store an Osm instance's transferables in IndexedDB.
 * @param info - The OsmInfo metadata
 * @param transferables - The Osm transferables to store
 * @param fileHash - Optional SHA-256 hash of the original file for deduplication
 */
export async function storeOsm(
	info: OsmInfo,
	transferables: OsmTransferables,
	fileHash?: string,
): Promise<void> {
	const db = await getDB()
	const storedOsm: StoredOsm = {
		id: info.id,
		info,
		transferables: toStorableTransferables(transferables),
		storedAt: Date.now(),
		fileHash,
	}
	await db.put(OSM_STORE, storedOsm)
}

/**
 * Load Osm transferables from IndexedDB.
 */
export async function loadOsmTransferables(
	id: string,
): Promise<OsmTransferables | null> {
	const db = await getDB()
	const stored = await db.get(OSM_STORE, id)
	if (!stored) return null
	return fromStorableTransferables(stored.transferables)
}

/**
 * Load a stored Osm entry from IndexedDB.
 * Returns the info and transferables in the proper OsmTransferables format.
 */
export async function loadStoredOsm(id: string): Promise<{
	id: string
	info: OsmInfo
	transferables: OsmTransferables
	storedAt: number
} | null> {
	const db = await getDB()
	const stored = await db.get(OSM_STORE, id)
	if (!stored) return null
	return {
		id: stored.id,
		info: stored.info,
		transferables: fromStorableTransferables(stored.transferables),
		storedAt: stored.storedAt,
	}
}

/**
 * Get all stored Osm entries (without the full transferables for listing).
 */
export async function listStoredOsm(): Promise<StoredOsmEntry[]> {
	const db = await getDB()
	const all = await db.getAll(OSM_STORE)
	return all.map(({ id, info, storedAt, fileHash }) => ({
		id,
		info,
		storedAt,
		fileHash,
	}))
}

/**
 * Delete a stored Osm entry from IndexedDB.
 */
export async function deleteStoredOsm(id: string): Promise<void> {
	const db = await getDB()
	await db.delete(OSM_STORE, id)
}

/**
 * Clear all stored Osm entries from IndexedDB.
 */
export async function clearStoredOsm(): Promise<void> {
	const db = await getDB()
	await db.clear(OSM_STORE)
}

/**
 * Check if an Osm entry exists in IndexedDB.
 */
export async function hasStoredOsm(id: string): Promise<boolean> {
	const db = await getDB()
	const count = await db.count(OSM_STORE, id)
	return count > 0
}

/**
 * Get the approximate storage size of stored Osm data.
 */
export async function getStorageStats(): Promise<{
	count: number
	estimatedBytes: number
}> {
	const db = await getDB()
	const all = await db.getAll(OSM_STORE)
	let estimatedBytes = 0
	for (const stored of all) {
		const t = stored.transferables
		estimatedBytes += t.stringTable.bytes.byteLength ?? 0
		estimatedBytes += t.stringTable.start.byteLength ?? 0
		estimatedBytes += t.stringTable.count.byteLength ?? 0
		estimatedBytes += t.nodes.lons.byteLength ?? 0
		estimatedBytes += t.nodes.lats.byteLength ?? 0
		estimatedBytes += t.nodes.spatialIndex.byteLength ?? 0
		estimatedBytes += t.ways.refStart.byteLength ?? 0
		estimatedBytes += t.ways.refCount.byteLength ?? 0
		estimatedBytes += t.ways.refs.byteLength ?? 0
		estimatedBytes += t.ways.bbox.byteLength ?? 0
		estimatedBytes += t.ways.spatialIndex.byteLength ?? 0
		estimatedBytes += t.relations.memberStart.byteLength ?? 0
		estimatedBytes += t.relations.memberCount.byteLength ?? 0
		estimatedBytes += t.relations.memberRefs.byteLength ?? 0
		estimatedBytes += t.relations.memberTypes.byteLength ?? 0
		estimatedBytes += t.relations.memberRoles.byteLength ?? 0
		estimatedBytes += t.relations.bbox.byteLength ?? 0
		estimatedBytes += t.relations.spatialIndex.byteLength ?? 0
	}
	return { count: all.length, estimatedBytes }
}
