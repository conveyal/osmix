/**
 * Jotai state for managing IndexedDB stored Osm entries.
 */

import { atom } from "jotai"
import { listStoredOsm, type StoredOsmEntry } from "../lib/osm-storage"

/**
 * Base atom that holds the list of stored Osm entries.
 */
const storedOsmEntriesBaseAtom = atom<StoredOsmEntry[]>([])

/**
 * Refresh counter to trigger re-fetching from IndexedDB.
 */
const refreshCounterAtom = atom(0)

/**
 * Atom that provides read access to stored entries and a refresh trigger.
 * Reading will return the current cached entries.
 * Writing will trigger a refresh from IndexedDB.
 */
export const storedOsmEntriesAtom = atom(
	(get) => {
		// Subscribe to refresh counter to trigger re-renders
		get(refreshCounterAtom)
		return get(storedOsmEntriesBaseAtom)
	},
	async (get, set) => {
		// Refresh from IndexedDB
		const entries = await listStoredOsm()
		set(storedOsmEntriesBaseAtom, entries)
		set(refreshCounterAtom, get(refreshCounterAtom) + 1)
	},
)

/**
 * Atom to track if storage operations are in progress.
 */
export const storageLoadingAtom = atom(false)
