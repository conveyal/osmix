/**
 * Hook for subscribing to storage changes via BroadcastChannel.
 *
 * The MergeWorker broadcasts storage changes when IndexedDB is modified,
 * allowing the UI to react without polling.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react"
import type { MergeRemote } from "../lib/merge-remote"
import { STORAGE_CHANNEL } from "../settings"
import type { StoredOsmEntry } from "../workers/osm.worker"

// Re-export types for convenience
export type { StoredFileInfo, StoredOsmEntry } from "../workers/osm.worker"

/** Snapshot of storage state for useSyncExternalStore */
interface StorageSnapshot {
	entries: StoredOsmEntry[]
	estimatedBytes: number
	loading: boolean
}

/**
 * Creates a storage subscription that listens to BroadcastChannel messages
 * and fetches the latest data from the remote.
 */
export function createStorageStore(remote: MergeRemote) {
	let snapshot: StorageSnapshot = {
		entries: [],
		estimatedBytes: 0,
		loading: true,
	}
	const listeners = new Set<() => void>()

	// Fetch latest data from remote
	const refresh = async () => {
		try {
			const [entries, stats] = await Promise.all([
				remote.listStoredOsm(),
				remote.getStorageStats(),
			])
			snapshot = {
				entries,
				estimatedBytes: stats.estimatedBytes,
				loading: false,
			}
		} catch {
			snapshot = { ...snapshot, loading: false }
		}
		for (const fn of listeners) fn()
	}

	// Set up BroadcastChannel listener
	let channel: BroadcastChannel | null = null

	const ensureChannel = () => {
		if (!channel) {
			channel = new BroadcastChannel(STORAGE_CHANNEL)
			channel.onmessage = () => refresh()
			// Initial fetch
			refresh()
		}
	}

	return {
		subscribe: (fn: () => void) => {
			ensureChannel()
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
				if (listeners.size === 0 && channel) {
					channel.close()
					channel = null
				}
			}
		},
		getSnapshot: () => snapshot,
		refresh,
	}
}

/** Global storage store instance - initialized lazily */
let storageStore: ReturnType<typeof createStorageStore> | null = null

/**
 * Hook to access stored Osm entries with automatic updates via BroadcastChannel.
 * Uses useSyncExternalStore for React 18+ concurrent mode compatibility.
 */
export function useStoredOsm(remote: MergeRemote) {
	// Initialize store on first use
	if (!storageStore) {
		storageStore = createStorageStore(remote)
	}

	const snapshot = useSyncExternalStore(
		storageStore.subscribe,
		storageStore.getSnapshot,
	)

	const refresh = useCallback(() => {
		storageStore?.refresh()
	}, [])

	return { ...snapshot, refresh }
}

/**
 * Simple hook to trigger a callback when storage changes.
 * Useful for components that need to react to storage updates
 * but manage their own state.
 */
export function useStorageBroadcast(onUpdate: () => void) {
	useEffect(() => {
		const channel = new BroadcastChannel(STORAGE_CHANNEL)
		channel.onmessage = onUpdate
		return () => channel.close()
	}, [onUpdate])
}
