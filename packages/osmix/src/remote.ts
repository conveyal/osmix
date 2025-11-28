import type { OsmChangeTypes, OsmMergeOptions } from "@osmix/change"
import { Osm, type OsmOptions } from "@osmix/core"
import { DEFAULT_RASTER_TILE_SIZE } from "@osmix/raster"
import type { Progress } from "@osmix/shared/progress"
import { streamToBytes } from "@osmix/shared/stream-to-bytes"
import type { OsmEntityType, Tile } from "@osmix/shared/types"
import * as Comlink from "comlink"
import { type OsmFromPbfOptions, osmToPbfStream } from "./pbf"
import {
	DEFAULT_WORKER_COUNT,
	SUPPORTS_SHARED_ARRAY_BUFFER,
	SUPPORTS_STREAM_TRANSFER,
	transfer,
} from "./utils"
import { createOsmixWorker, type OsmixWorker } from "./worker"

type OsmId = string | Osm

export interface OsmixRemoteOptions {
	workerCount?: number
	onProgress?: (progress: Progress) => void
	/**
	 * Custom worker URL for extended OsmixWorker implementations.
	 * When provided, workers will be created from this URL instead of the default.
	 *
	 * @example
	 * // Use a custom worker with extended functionality
	 * const remote = await OsmixRemote.connect({
	 *   workerUrl: new URL("./my-custom.worker.ts", import.meta.url)
	 * })
	 */
	workerUrl?: URL
}

/**
 * Manage data access across one or more workers while using the same API as a local Osmix instance.
 * Coordinates work distribution and synchronizes data across multiple workers using SharedArrayBuffer.
 *
 * The generic type parameter T allows typing custom worker implementations:
 * @example
 * class MyWorker extends OsmixWorker {
 *   myMethod(id: string) { ... }
 * }
 * const remote = await OsmixRemote.connect<MyWorker>({
 *   workerUrl: new URL("./my.worker.ts", import.meta.url)
 * })
 * // remote.getWorker() returns Comlink.Remote<MyWorker>
 */
export class OsmixRemote<T extends OsmixWorker = OsmixWorker> {
	private workers: Comlink.Remote<T>[] = []
	private changesetWorker: Comlink.Remote<T> | null = null

	/**
	 * Create a new OsmixRemote instance and initialize worker pool.
	 * Multiple workers are only supported when SharedArrayBuffer is available.
	 * Each worker receives the same progress listener proxy if provided.
	 *
	 * @example
	 * // Default usage
	 * const remote = await OsmixRemote.connect()
	 *
	 * @example
	 * // With custom worker for extended functionality
	 * const remote = await OsmixRemote.connect({
	 *   workerUrl: new URL("./shortbread.worker.ts", import.meta.url)
	 * })
	 */
	static async connect<T extends OsmixWorker = OsmixWorker>({
		workerCount = DEFAULT_WORKER_COUNT,
		onProgress,
		workerUrl,
	}: OsmixRemoteOptions = {}): Promise<OsmixRemote<T>> {
		const remote = new OsmixRemote<T>()
		if (workerCount < 1) throw Error("Worker count must be at least 1")
		if (workerCount > 1 && !SUPPORTS_SHARED_ARRAY_BUFFER)
			throw Error(
				"SharedArrayBuffer not supported, cannot use multiple workers.",
			)
		for (let i = 0; i < workerCount; i++) {
			const worker = await createOsmixWorker<T>(workerUrl)
			if (onProgress) {
				await worker.addProgressListener(Comlink.proxy(onProgress))
			}
			remote.workers.push(worker)
		}
		remote.changesetWorker = remote.workers[0]!
		return remote
	}

	/**
	 * Select the next available worker in a round-robin fashion.
	 * Cycles workers to balance load across the pool.
	 * @private
	 */
	private nextWorker() {
		const nextWorker = this.workers.shift()
		if (!nextWorker) throw Error("No worker available")
		this.workers.push(nextWorker)
		return nextWorker
	}

	/**
	 * Get a worker proxy for calling custom methods on extended workers.
	 * Returns the next worker in the pool using round-robin selection.
	 *
	 * @example
	 * class ShortbreadWorker extends OsmixWorker {
	 *   getShortbreadVectorTile(id: string, tile: Tile) { ... }
	 * }
	 * const remote = await OsmixRemote.connect<ShortbreadWorker>({
	 *   workerUrl: new URL("./shortbread.worker.ts", import.meta.url)
	 * })
	 * const tile = await remote.getWorker().getShortbreadVectorTile(osmId, tile)
	 */
	getWorker(): Comlink.Remote<T> {
		return this.nextWorker()
	}

	/**
	 * Retrieve the dedicated changeset worker.
	 * Changesets must always be handled by the same worker to maintain consistency.
	 */
	private getChangesetWorker() {
		if (!this.changesetWorker) throw Error("No changeset worker available")
		return this.changesetWorker
	}

	/**
	 * Convert various input types into a transferable format suitable for posting to workers.
	 * Falls back to converting streams to buffers if stream transfer is unsupported.
	 */
	private async getTransferableData(
		data: ArrayBufferLike | ReadableStream | Uint8Array | File,
	) {
		if (data instanceof ArrayBuffer) return data
		if (data instanceof SharedArrayBuffer) return data
		if (data instanceof Uint8Array) return data.buffer
		if (data instanceof ReadableStream) {
			if (SUPPORTS_STREAM_TRANSFER) return data
			return (await streamToBytes(data)).buffer
		}
		if (data instanceof File) {
			if (SUPPORTS_STREAM_TRANSFER) return data.stream()
			return data.arrayBuffer()
		}
		throw Error("Invalid data")
	}

	/**
	 * Synchronize an Osmix instance from one worker to all others using SharedArrayBuffer.
	 * No-op if SharedArrayBuffer is unsupported (single-worker mode).
	 */
	private async populateOtherWorkers(
		worker: Comlink.Remote<OsmixWorker>,
		osmId: OsmId,
	) {
		if (!SUPPORTS_SHARED_ARRAY_BUFFER) return
		const transferables = await worker.getOsmBuffers(this.getId(osmId))
		await Promise.all(
			this.workers.map((worker) => worker.transferIn(transferables)),
		)
	}

	/**
	 * Load an Osmix instance from PBF data in a worker.
	 * Data is sent to the first available worker, then synchronized across all workers.
	 */
	async fromPbf(
		data: ArrayBufferLike | ReadableStream | Uint8Array | File,
		options: Partial<OsmFromPbfOptions> = {},
	) {
		const workers = this.workers.slice()
		const worker0 = workers.shift()!
		const osmInfo = await worker0.fromPbf(
			transfer({ data: await this.getTransferableData(data), options }),
		)
		await this.populateOtherWorkers(worker0, osmInfo.id)
		return osmInfo
	}

	/**
	 * Serialize an Osmix instance to PBF and pipe into the provided writable stream.
	 * Requires browser support for transferable streams.
	 */
	toPbfStream(osmId: OsmId, writeableStream: WritableStream<Uint8Array>) {
		if (!SUPPORTS_STREAM_TRANSFER) throw Error("Stream transfer not supported")
		return this.nextWorker().toPbfStream(
			Comlink.transfer({ osmId: this.getId(osmId), writeableStream }, [
				writeableStream,
			]),
		)
	}

	/**
	 * Serialize an Osmix instance to a single PBF buffer.
	 * Returns the buffer transferred from the worker.
	 */
	toPbfData(osmId: OsmId) {
		return this.nextWorker().toPbf(this.getId(osmId))
	}

	/**
	 * Serialize an Osmix instance to PBF and write to the provided stream.
	 * Automatically selects worker-based streaming or fallback based on browser support.
	 */
	async toPbf(osmId: OsmId, stream: WritableStream<Uint8Array>) {
		if (SUPPORTS_STREAM_TRANSFER) return this.toPbfStream(osmId, stream)
		const osm = await this.get(osmId)
		return osmToPbfStream(osm).pipeTo(stream)
	}

	/**
	 * Load an Osmix instance from GeoJSON data in a worker.
	 * Data is sent to the first available worker, then synchronized across all workers.
	 */
	async fromGeoJSON(
		data: ArrayBufferLike | ReadableStream | Uint8Array | File,
		options: Partial<OsmOptions> = {},
	) {
		const workers = this.workers.slice()
		const worker0 = workers.shift()!
		const osmInfo = await worker0.fromGeoJSON(
			transfer({
				data: await this.getTransferableData(data),
				options,
			}),
		)
		await this.populateOtherWorkers(worker0, osmInfo.id)
		return osmInfo
	}

	/**
	 * Load an Osmix instance from a File, auto-detecting format by extension.
	 * .geojson and .json files are loaded as GeoJSON; all others as PBF.
	 */
	async fromFile(file: File, options: Partial<OsmOptions> = {}) {
		const fileName = file.name.toLowerCase()
		const isGeoJSON =
			fileName.endsWith(".geojson") || fileName.endsWith(".json")
		return isGeoJSON
			? this.fromGeoJSON(file, { ...options, id: options.id ?? file.name })
			: this.fromPbf(file, { ...options, id: options.id ?? file.name })
	}

	/**
	 * Read only the header from PBF data without loading entities.
	 * Useful for previewing metadata before committing to a full load.
	 */
	async readHeader(data: ArrayBuffer | ReadableStream | Uint8Array | File) {
		return this.nextWorker().readHeader(await this.getTransferableData(data))
	}

	/**
	 * Extract the string ID from an OsmId union type.
	 * Accepts either a string ID or an Osm instance.
	 */
	getId(osmId: OsmId) {
		if (typeof osmId === "string") {
			return osmId
		}
		return osmId.id
	}

	/**
	 * Check if an Osmix instance has completed index building and is ready for queries.
	 */
	async isReady(osmId: OsmId) {
		try {
			await Promise.all(
				this.workers.map(async (worker) => {
					const isReady = await worker.isReady(this.getId(osmId))
					if (!isReady) throw Error("Osmix instance is not ready")
				}),
			)
		} catch {
			return false
		}
		return true
	}

	/**
	 * Check if an Osmix instance exists in any worker.
	 */
	has(osmId: OsmId) {
		return this.nextWorker().has(this.getId(osmId))
	}

	/**
	 * Retrieve an Osmix instance from a worker and reconstruct it on the main thread.
	 * Useful for direct access when worker overhead is unnecessary.
	 */
	async get(osmId: OsmId): Promise<Osm> {
		const transferables = await this.nextWorker().getOsmBuffers(
			this.getId(osmId),
		)
		return new Osm(transferables)
	}

	/**
	 * Transfer an Osmix instance from workers back to the main thread and remove it from workers.
	 * Useful for final cleanup or moving data out of worker context.
	 */
	async transferOut(osmId: OsmId): Promise<Osm> {
		const transferables = await this.nextWorker().transferOut(this.getId(osmId))
		await this.delete(osmId)
		return new Osm(transferables)
	}

	/**
	 * Transfer an Osm instance from the main thread into all workers.
	 * Distributes data across the worker pool for parallel operations.
	 */
	async transferIn(osm: Osm): Promise<void> {
		await Promise.all(
			this.workers.map((worker) =>
				worker.transferIn(transfer(osm.transferables())),
			),
		)
	}

	/**
	 * Remove an Osmix instance from all workers, freeing its memory.
	 */
	async delete(osmId: OsmId): Promise<void> {
		await Promise.all(
			this.workers.map((worker) => worker.delete(this.getId(osmId))),
		)
	}

	/**
	 * Generate a Mapbox Vector Tile for the specified tile coordinates.
	 * Delegates to an available worker for off-thread rendering.
	 */
	getVectorTile(osmId: OsmId, tile: Tile) {
		return this.nextWorker().getVectorTile(this.getId(osmId), tile)
	}

	/**
	 * Generate a raster tile as ImageData for the specified tile coordinates.
	 * Delegates to an available worker for off-thread rendering.
	 */
	getRasterTile(osmId: OsmId, tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		return this.nextWorker().getRasterTile(this.getId(osmId), tile, tileSize)
	}

	/**
	 * Search for OSM entities by tag key and optional value.
	 * Delegates to an available worker for off-thread search.
	 */
	search(osmId: OsmId, key: string, val?: string) {
		return this.nextWorker().search(this.getId(osmId), key, val)
	}

	/**
	 * Merge two Osmix instances in a worker.
	 * Replaces the base instance with the merge result and deletes the patch instance.
	 * Synchronizes the merged result across all workers.
	 */
	async merge(
		baseOsmId: OsmId,
		patchOsmId: OsmId,
		options: Partial<OsmMergeOptions> = {},
	) {
		const worker0 = this.nextWorker()
		const osmId = await worker0.merge(
			this.getId(baseOsmId),
			this.getId(patchOsmId),
			options,
		)
		await this.populateOtherWorkers(worker0, osmId)
		await this.delete(patchOsmId)
		return osmId
	}

	/**
	 * Generate a changeset comparing base and patch Osmix instances in the changeset worker.
	 * Returns statistics about the changeset (create/modify/delete counts).
	 */
	async generateChangeset(
		baseOsmId: OsmId,
		patchOsmId: OsmId,
		options: Partial<OsmMergeOptions> = {},
	) {
		return this.getChangesetWorker().generateChangeset(
			this.getId(baseOsmId),
			this.getId(patchOsmId),
			options,
		)
	}

	/**
	 * Apply the active changeset to its base Osmix instance and replace it with the result.
	 * Synchronizes the updated instance across all workers.
	 */
	async applyChangesAndReplace(osmId: OsmId) {
		const worker0 = this.getChangesetWorker()
		await worker0.applyChangesAndReplace(this.getId(osmId))
		await this.populateOtherWorkers(worker0, osmId)
	}

	/**
	 * Update filter settings for changeset viewing in the changeset worker.
	 * Filters control which change types and entity types are visible when paginating.
	 */
	setChangesetFilters(
		changeTypes: OsmChangeTypes[],
		entityTypes: OsmEntityType[],
	) {
		this.getChangesetWorker().setChangesetFilters(changeTypes, entityTypes)
	}

	/**
	 * Retrieve a paginated subset of the filtered changeset from the changeset worker.
	 */
	getChangesetPage(osmId: OsmId, page: number, pageSize: number) {
		return this.getChangesetWorker().getChangesetPage(
			this.getId(osmId),
			page,
			pageSize,
		)
	}
}
