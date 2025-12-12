/**
 * IndexedDB storage for Osm transferables using the idb library.
 *
 * Stores `OsmTransferables` so they can be reloaded without re-parsing PBF files,
 * similar to how they're transferred across WebWorkers.
 */

import type { OsmInfo, OsmTransferables } from "@osmix/core"
import { openDB, type DBSchema, type IDBPDatabase } from "idb"

const DB_NAME = "osmix-storage"
const DB_VERSION = 1
const OSM_STORE = "osm"

export interface StoredOsm {
	id: string
	info: OsmInfo
	transferables: OsmTransferables
	storedAt: number
}

export interface StoredOsmEntry {
	id: string
	info: OsmInfo
	storedAt: number
}

interface OsmixDB extends DBSchema {
	[OSM_STORE]: {
		key: string
		value: StoredOsm
		indexes: {
			"by-stored-at": number
		}
	}
}

let dbPromise: Promise<IDBPDatabase<OsmixDB>> | null = null

function getDB(): Promise<IDBPDatabase<OsmixDB>> {
	if (!dbPromise) {
		dbPromise = openDB<OsmixDB>(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(OSM_STORE)) {
					const store = db.createObjectStore(OSM_STORE, { keyPath: "id" })
					store.createIndex("by-stored-at", "storedAt")
				}
			},
		})
	}
	return dbPromise
}

/**
 * Store an Osm instance's transferables in IndexedDB.
 */
export async function storeOsm(
	info: OsmInfo,
	transferables: OsmTransferables,
): Promise<void> {
	const db = await getDB()
	const storedOsm: StoredOsm = {
		id: info.id,
		info,
		transferables,
		storedAt: Date.now(),
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
	return stored?.transferables ?? null
}

/**
 * Load a stored Osm entry from IndexedDB.
 */
export async function loadStoredOsm(id: string): Promise<StoredOsm | null> {
	const db = await getDB()
	return (await db.get(OSM_STORE, id)) ?? null
}

/**
 * Get all stored Osm entries (without the full transferables for listing).
 */
export async function listStoredOsm(): Promise<StoredOsmEntry[]> {
	const db = await getDB()
	const all = await db.getAll(OSM_STORE)
	return all.map(({ id, info, storedAt }) => ({ id, info, storedAt }))
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
