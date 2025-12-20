/**
 * Extended OsmixRemote with IndexedDB storage capabilities.
 *
 * Provides a clean API for storage operations by wrapping the MergeWorker
 * methods, following the same pattern as the base OsmixRemote class.
 */

import type { Progress } from "@osmix/shared/progress"
import { type OsmId, type OsmInfo, OsmixRemote } from "osmix"
import type {
	MergeWorker,
	StoredFileInfo,
	StoredOsmEntry,
} from "../workers/osm.worker"
import OsmWorkerUrl from "../workers/osm.worker.ts?worker&url"

export interface MergeRemoteOptions {
	workerCount?: number
	onProgress?: (progress: Progress) => void
}

/**
 * Create a new MergeRemote instance with initialized worker pool.
 *
 * @example
 * const remote = await createMergeRemote({
 *   onProgress: (progress) => console.log(progress.msg),
 * })
 * const hash = await remote.hashBuffer(buffer)
 */
export async function createMergeRemote(
	options: MergeRemoteOptions = {},
): Promise<MergeRemote> {
	const remote = new MergeRemote()
	await remote.initializeWorkerPool(
		options.workerCount ?? 1,
		new URL(OsmWorkerUrl, import.meta.url),
		options.onProgress,
	)
	return remote
}

/**
 * Extended OsmixRemote with storage capabilities.
 *
 * Wraps MergeWorker storage methods to provide a consistent API
 * that follows the OsmixRemote pattern. All storage operations
 * are delegated to workers to keep the main thread responsive.
 */
export class MergeRemote extends OsmixRemote<MergeWorker> {
	/**
	 * Compute SHA-256 hash of an ArrayBuffer in a worker.
	 * Returns the hash as a hex string.
	 */
	hashBuffer(data: ArrayBuffer): Promise<string> {
		return this.getWorker().hashBuffer(data)
	}

	/**
	 * Find a stored entry by file hash.
	 * Returns the stored entry metadata if found, null otherwise.
	 */
	findByHash(hash: string): Promise<StoredOsmEntry | null> {
		return this.getWorker().findByHash(hash)
	}

	/**
	 * Store the currently-loaded Osm instance to IndexedDB.
	 * The Osm must already be loaded in the worker (via fromPbf, etc.).
	 */
	storeCurrentOsm(osmId: OsmId, fileInfo: StoredFileInfo): Promise<void> {
		return this.getWorker().storeCurrentOsm(this.getId(osmId), fileInfo)
	}

	/**
	 * Load an Osm from IndexedDB by storage ID and register it in workers.
	 * Builds spatial indexes automatically after loading.
	 * Returns the entry and info if found, null otherwise.
	 */
	async loadFromStorage(osmId: OsmId): Promise<{
		entry: StoredOsmEntry
		info: OsmInfo
	} | null> {
		const worker = this.getWorker()
		const osmEntry = await worker.loadFromStorage(this.getId(osmId))
		if (!osmEntry) return null
		await this.populateOtherWorkers(worker, osmId)
		return osmEntry
	}

	/**
	 * Get all stored Osm entries (metadata only).
	 */
	listStoredOsm(): Promise<StoredOsmEntry[]> {
		return this.getWorker().listStoredOsm()
	}

	/**
	 * Delete a stored Osm entry from IndexedDB.
	 */
	deleteStoredOsm(id: string): Promise<void> {
		return this.getWorker().deleteStoredOsm(id)
	}

	/**
	 * Get storage statistics.
	 */
	getStorageStats(): Promise<{ count: number; estimatedBytes: number }> {
		return this.getWorker().getStorageStats()
	}
}
