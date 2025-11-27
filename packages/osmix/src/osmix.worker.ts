import {
	applyChangesetToOsm,
	merge,
	type OsmChange,
	type OsmChangeset,
	type OsmChangeTypes,
	type OsmMergeOptions,
} from "@osmix/change"
import type { OsmOptions, OsmTransferables } from "@osmix/core"
import { DEFAULT_RASTER_TILE_SIZE } from "@osmix/raster"
import type { Progress, ProgressEvent } from "@osmix/shared/progress"
import type { OsmEntityType, Tile } from "@osmix/shared/types"
import * as Comlink from "comlink"
import { dequal } from "dequal/lite"
import { Osmix } from "./osmix"
import type { OsmFromPbfOptions } from "./pbf"
import { transfer } from "./utils"

/**
 * Worker handler for managing multiple Osmix instances within a Web Worker.
 * Exposes Comlink-wrapped methods for off-thread OSM data operations.
 */
export class OsmixWorker extends EventTarget {
	private osm: Record<string, Osmix> = {}
	private changesets: Record<string, OsmChangeset> = {}
	private changeTypes: OsmChangeTypes[] = ["create", "modify", "delete"]
	private entityTypes: OsmEntityType[] = ["node", "way", "relation"]
	private filteredChanges: Record<string, OsmChange[]> = {}

	private onProgress = (progress: ProgressEvent) => this.dispatchEvent(progress)

	/**
	 * Register a progress listener to receive updates during long-running operations.
	 * Listener is proxied through Comlink for cross-thread communication.
	 */
	addProgressListener(listener: (progress: Progress) => void) {
		this.addEventListener("progress", (e: Event) =>
			listener((e as ProgressEvent).detail),
		)
	}

	/**
	 * Read only the header from PBF data without parsing entities.
	 * Delegates to static Osmix.readHeader method.
	 */
	readHeader(data: ArrayBufferLike | ReadableStream) {
		return Osmix.readHeader(
			data instanceof ReadableStream ? data : new Uint8Array(data),
		)
	}

	/**
	 * Load an Osmix instance from PBF data and store it in this worker.
	 * Returns OSM metadata including entity counts and bbox.
	 */
	async fromPbf({
		data,
		options,
	}: {
		data: ArrayBufferLike | ReadableStream
		options?: Partial<OsmFromPbfOptions>
	}) {
		const osm = await Osmix.fromPbf(data, options, this.onProgress)
		this.set(osm.id, osm)
		return osm.info()
	}

	/**
	 * Serialize an Osmix instance to PBF and pipe into the provided writable stream.
	 * Stream is transferred from the main thread for zero-copy efficiency.
	 */
	toPbfStream({
		osmId,
		writeableStream,
	}: {
		osmId: string
		writeableStream: WritableStream<Uint8Array>
	}) {
		return this.get(osmId).toPbfStream().pipeTo(writeableStream)
	}

	/**
	 * Serialize an Osmix instance to a single PBF buffer.
	 * Result is transferred back to the main thread.
	 */
	async toPbf(osmId: string) {
		const data = await this.get(osmId).toPbf()
		return Comlink.transfer(data, [data.buffer])
	}

	/**
	 * Load an Osmix instance from GeoJSON data and store it in this worker.
	 * Returns OSM metadata including entity counts and bbox.
	 */
	async fromGeoJSON({
		data,
		options,
	}: {
		data: ArrayBufferLike | ReadableStream
		options?: Partial<OsmOptions>
	}) {
		const osm = await Osmix.fromGeoJSON(data, options, this.onProgress)
		this.set(osm.id, osm)
		return osm.info()
	}

	/**
	 * Accept transferables from another worker or main thread and reconstruct an Osmix instance.
	 * Used when SharedArrayBuffer is supported to share data across workers.
	 */
	transferIn(transferables: OsmTransferables) {
		this.set(transferables.id, new Osmix(transferables))
	}

	/**
	 * Transfer an Osmix instance out of this worker and remove it.
	 * Transfers underlying buffers for efficient cross-thread movement.
	 */
	transferOut(id: string) {
		const transferables = this.get(id).transferables()
		this.delete(id)
		return transfer(transferables)
	}

	/**
	 * Get the raw transferable buffers for an Osmix instance without removing it.
	 * Used to duplicate data across workers when SharedArrayBuffer is available.
	 */
	getOsmBuffers(id: string) {
		return this.get(id).transferables()
	}

	/**
	 * Check if an Osmix instance with the given ID exists in this worker.
	 */
	has(id: string): boolean {
		return this.osm[id] != null
	}

	/**
	 * Check if an Osmix instance has completed index building and is ready for queries.
	 */
	isReady(id: string): boolean {
		return this.osm[id]?.isReady() ?? false
	}

	/**
	 * Retrieve an Osmix instance by ID, throwing if not found.
	 * Protected to allow subclasses to access stored Osmix instances.
	 */
	protected get(id: string) {
		if (!this.osm[id]) throw Error(`OSM not found for id: ${id}`)
		return this.osm[id]
	}

	/**
	 * Store an Osmix instance by ID, replacing any existing instance with the same ID.
	 * Protected to allow subclasses to manage Osmix instances.
	 */
	protected set(id: string, osm: Osmix) {
		this.osm[id] = osm
	}

	/**
	 * Remove an Osmix instance from this worker, freeing its memory.
	 */
	delete(id: string) {
		delete this.osm[id]
	}

	/**
	 * Generate a Mapbox Vector Tile for the specified tile coordinates.
	 * Returns transferred MVT data suitable for MapLibre rendering.
	 */
	getVectorTile(id: string, tile: Tile) {
		const data = this.get(id).getVectorTile(tile)
		if (!data || data.byteLength === 0) return new ArrayBuffer(0)
		return Comlink.transfer(data, [data])
	}

	/**
	 * Generate a raster tile as ImageData for the specified tile coordinates.
	 * Returns transferred RGBA pixel data suitable for canvas rendering.
	 */
	getRasterTile(id: string, tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		const data = this.get(id).getRasterTile(tile, tileSize)
		if (!data || data.byteLength === 0) return new Uint8ClampedArray(0)
		return Comlink.transfer(data, [data.buffer])
	}

	/**
	 * Search for OSM entities by tag key and optional value.
	 * Returns matching nodes, ways, and relations.
	 */
	search(id: string, key: string, val?: string) {
		return this.get(id).search(key, val)
	}

	/**
	 * Perform a full merge of two Osm indexes inside of a worker. Both Osm indexes must be loaded already.
	 * Replaces the base Osm and deletes the patch Osm.
	 */
	async merge(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmMergeOptions> = {},
	) {
		const baseOsm = this.get(baseOsmId)
		const patchOsm = this.get(patchOsmId)
		const mergedOsm = await merge(baseOsm, patchOsm, options, this.onProgress)
		this.set(baseOsmId, new Osmix(mergedOsm.transferables()))
		this.delete(patchOsmId)
		return mergedOsm.id
	}

	/**
	 * Generate a changeset comparing base and patch Osm instances.
	 * Stores the changeset internally and returns stats (counts by change type).
	 * Changeset is automatically sorted by the current filter settings.
	 */
	async generateChangeset(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmMergeOptions> = {},
	) {
		const changeset = this.get(baseOsmId).createChangeset(
			this.get(patchOsmId),
			options,
			this.onProgress,
		)
		this.changesets[baseOsmId] = changeset
		this.sortChangeset(baseOsmId, changeset)
		return changeset.stats
	}

	/**
	 * Update filter settings for changeset viewing.
	 * Re-sorts all active changesets with the new filters.
	 * Skips re-sorting if filters are identical to current settings.
	 */
	setChangesetFilters(
		changeTypes: OsmChangeTypes[],
		entityTypes: OsmEntityType[],
	) {
		if (
			dequal(this.changeTypes, changeTypes) &&
			dequal(this.entityTypes, entityTypes)
		) {
			return
		}
		this.changeTypes = changeTypes
		this.entityTypes = entityTypes

		// Sort all changesets with new filters
		for (const [osmId, changeset] of Object.entries(this.changesets)) {
			this.sortChangeset(osmId, changeset)
		}
	}

	/**
	 * Retrieve a paginated subset of the filtered changeset.
	 * Returns changes for the specified page and the total number of pages.
	 */
	getChangesetPage(osmId: string, page: number, pageSize: number) {
		const changeset = this.changesets[osmId]
		if (!changeset) throw Error("No active changeset")
		const filteredChanges = this.filteredChanges[osmId]
		const changes = filteredChanges?.slice(
			page * pageSize,
			(page + 1) * pageSize,
		)
		return {
			changes,
			totalPages: Math.ceil((filteredChanges?.length ?? 0) / pageSize),
		}
	}

	/**
	 * Apply a changeset to the base Osm instance, replacing it with the merged result.
	 * Deletes the changeset after application.
	 */
	applyChangesAndReplace(osmId: string) {
		const changeset = this.changesets[osmId]
		if (!changeset) throw Error("No active changeset")
		const newOsm = applyChangesetToOsm(changeset)
		this.set(osmId, new Osmix(newOsm))
		delete this.changesets[osmId]
		delete this.filteredChanges[osmId]
		return newOsm.id
	}

	/**
	 * Filter and sort changeset entries by the current entity type and change type filters.
	 * Updates the filteredChanges cache for efficient pagination.
	 */
	private sortChangeset(osmId: string, changeset: OsmChangeset) {
		const filteredChanges: OsmChange[] = []
		if (this.entityTypes.includes("node")) {
			for (const change of Object.values(changeset.nodeChanges)) {
				if (this.changeTypes.includes(change.changeType)) {
					filteredChanges.push(change)
				}
			}
		}
		if (this.entityTypes.includes("way")) {
			for (const change of Object.values(changeset.wayChanges)) {
				if (this.changeTypes.includes(change.changeType)) {
					filteredChanges.push(change)
				}
			}
		}
		if (this.entityTypes.includes("relation")) {
			for (const change of Object.values(changeset.relationChanges)) {
				if (this.changeTypes.includes(change.changeType)) {
					filteredChanges.push(change)
				}
			}
		}
		this.filteredChanges[osmId] = filteredChanges
	}
}

/**
 * Expose a worker instance via Comlink.
 * Use this helper when creating custom worker entry points.
 *
 * @example
 * // my-custom.worker.ts
 * import { OsmixWorker, exposeWorker } from "osmix/worker"
 *
 * class MyCustomWorker extends OsmixWorker {
 *   myCustomMethod(id: string) {
 *     const osm = this.get(id)
 *     // ... custom logic
 *   }
 * }
 *
 * exposeWorker(new MyCustomWorker())
 */
export function exposeWorker<T extends OsmixWorker>(worker: T) {
	Comlink.expose(worker)
}

// Default worker entry point - expose a standard OsmixWorker instance
exposeWorker(new OsmixWorker())
