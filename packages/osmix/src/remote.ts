/**
 * Worker-based remote API for OSM operations.
 *
 * OsmixRemote manages a pool of Web Workers and provides a high-level API
 * for loading, querying, and manipulating OSM data off the main thread.
 * Uses SharedArrayBuffer for efficient multi-worker data sharing when available.
 *
 * @module
 */

import type { OsmChangeTypes, OsmMergeOptions } from "@osmix/change"
import { Osm, type OsmInfo, type OsmOptions } from "@osmix/core"
import { DEFAULT_RASTER_TILE_SIZE } from "@osmix/raster"
import type {
	DefaultSpeeds,
	HighwayFilter,
	RouteOptions,
	RouteResult,
} from "@osmix/router"
import type { Progress } from "@osmix/shared/progress"
import { streamToBytes } from "@osmix/shared/stream-to-bytes"
import type { LonLat, OsmEntityType, Tile } from "@osmix/shared/types"
import * as Comlink from "comlink"
import { type OsmFromPbfOptions, toPbfStream } from "./pbf"
import {
	DEFAULT_WORKER_COUNT,
	SUPPORTS_SHARED_ARRAY_BUFFER,
	SUPPORTS_STREAM_TRANSFER,
} from "./settings"
import { transfer } from "./utils"
import type { OsmixWorker } from "./worker"

/** Identifier for an OSM dataset: string ID, Osm instance, or OsmInfo object. */
export type OsmId = string | Osm | OsmInfo

export interface OsmixRemoteOptions {
	workerCount?: number
	onProgress?: (progress: Progress) => void
	/**
	 * Custom worker URL for extended OsmixWorker implementations.
	 * When provided, workers will be created from this URL instead of the default.
	 *
	 * @example
	 * // Use a custom worker with extended functionality
	 * const remote = await createRemote({
	 *   workerUrl: new URL("./my-custom.worker.ts", import.meta.url)
	 * })
	 */
	workerUrl?: URL
}

/**
 * Create a new `OsmixRemote` instance and initialize worker pool.
 * Multiple workers are only supported when SharedArrayBuffer is available.
 * Each worker receives the same progress listener proxy if provided.
 *
 * @example
 * // Default usage
 * const remote = await createRemote()
 *
 * @example
 * // With custom worker for extended functionality
 * const remote = await createRemote({
 *   workerUrl: new URL("./shortbread.worker.ts", import.meta.url)
 * })
 */
export async function createRemote<T extends OsmixWorker = OsmixWorker>({
	workerCount = DEFAULT_WORKER_COUNT,
	onProgress,
	workerUrl,
}: OsmixRemoteOptions = {}): Promise<OsmixRemote<T>> {
	const remote = new OsmixRemote<T>()
	await remote.initializeWorkerPool(workerCount, workerUrl, onProgress)
	return remote
}

/**
 * Create a single `OsmixWorker` instance wrapped with Comlink.
 * Spawns a new Web Worker and returns a proxy for cross-thread RPC.
 *
 * @param workerUrl - Optional URL to a custom worker file. If not provided,
 *                    uses the default `OsmixWorker`.
 *
 * @example
 * // Default worker
 * const worker = await createOsmixWorker()
 *
 * @example
 * // Custom worker
 * const worker = await createOsmixWorker<MyCustomWorker>(
 *   new URL("./my-custom.worker.ts", import.meta.url)
 * )
 */
export async function createOsmixWorker<T extends OsmixWorker = OsmixWorker>(
	workerUrl?: URL,
): Promise<Comlink.Remote<T>> {
	if (typeof Worker === "undefined") {
		throw Error("Worker not supported")
	}
	const url = workerUrl ?? new URL("./osmix.worker.ts", import.meta.url)
	const worker = new Worker(url, { type: "module" })
	return Comlink.wrap<T>(worker)
}

/**
 * Manage Osm instances access across one or more workers. Coordinates work distribution and synchronizes
 * data across multiple workers using `SharedArrayBuffer`s.
 *
 * The generic type parameter T allows typing custom worker implementations:
 * @example
 * class MyWorker extends OsmixWorker {
 *   myMethod(id: string) { ... }
 * }
 * const remote = await createRemote<MyWorker>({
 *   workerUrl: new URL("./my.worker.ts", import.meta.url)
 * })
 * // remote.getWorker() returns Comlink.Remote<MyWorker>
 */
export class OsmixRemote<T extends OsmixWorker = OsmixWorker> {
	private workers: Comlink.Remote<T>[] = []
	private changesetWorker: Comlink.Remote<T> | null = null

	/**
	 * Initialize workers.
	 * - Use a custom worker by passing a worker URL.
	 * - Pass a progress listener to receive updates during long-running operations.
	 * - Multiple workers are only supported when SharedArrayBuffer is available.
	 */
	async initializeWorkerPool(
		workerCount: number,
		workerUrl?: URL,
		onProgress?: (progress: Progress) => void,
	) {
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
			this.workers.push(worker)
		}
		this.changesetWorker = this.workers[0]!
	}

	/**
	 * Select the next available worker in a round-robin fashion.
	 * Cycles workers to balance load across the pool.
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
	 * const remote = await createRemote<ShortbreadWorker>({
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
	 * Synchronize an `Osm` instance from one worker to all others using SharedArrayBuffer.
	 * No-op if SharedArrayBuffer is unsupported (single-worker mode).
	 */
	protected async populateOtherWorkers(
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
	 * Load an `Osm` instance from PBF data in a worker.
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
	 * Serialize an `Osm` instance to PBF and pipe into the provided writable stream.
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
	 * Serialize an `Osm` instance to a single PBF buffer.
	 * Returns the buffer transferred from the worker.
	 */
	toPbfData(osmId: OsmId) {
		return this.nextWorker().toPbf(this.getId(osmId))
	}

	/**
	 * Serialize an `Osm` instance to PBF and write to the provided stream.
	 * Automatically selects worker-based streaming or fallback based on browser support.
	 */
	async toPbf(osmId: OsmId, stream: WritableStream<Uint8Array>) {
		if (SUPPORTS_STREAM_TRANSFER) return this.toPbfStream(osmId, stream)
		const osm = await this.get(osmId)
		return toPbfStream(osm).pipeTo(stream)
	}

	/**
	 * Load an `Osm` instance from GeoJSON data in a worker.
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
	 * Load an `Osm` instance from Shapefile (ZIP) data in a worker.
	 * Data is sent to the first available worker, then synchronized across all workers.
	 */
	async fromShapefile(
		data: ArrayBufferLike | ReadableStream | Uint8Array | File,
		options: Partial<OsmOptions> = {},
	) {
		const workers = this.workers.slice()
		const worker0 = workers.shift()!
		const osmInfo = await worker0.fromShapefile(
			transfer({
				data: await this.getTransferableData(data),
				options,
			}),
		)
		await this.populateOtherWorkers(worker0, osmInfo.id)
		return osmInfo
	}

	/**
	 * Load an `Osm` instance from a File, auto-detecting format by extension.
	 * - .geojson and .json files are loaded as GeoJSON
	 * - .zip files are loaded as Shapefiles
	 * - All others are loaded as PBF
	 */
	async fromFile(file: File, options: Partial<OsmOptions> = {}) {
		const fileName = file.name.toLowerCase()
		const isGeoJSON =
			fileName.endsWith(".geojson") || fileName.endsWith(".json")
		const isShapefile = fileName.endsWith(".zip")
		if (isGeoJSON) {
			return this.fromGeoJSON(file, { ...options, id: options.id ?? file.name })
		}
		if (isShapefile) {
			return this.fromShapefile(file, {
				...options,
				id: options.id ?? file.name,
			})
		}
		return this.fromPbf(file, { ...options, id: options.id ?? file.name })
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
	 * Accepts a string ID, an `Osm` instance, or an `OsmInfo` object.
	 */
	getId(osmId: OsmId) {
		if (typeof osmId === "string") {
			return osmId
		}
		return osmId.id
	}

	/**
	 * Check if an Osm instance has completed index building and is ready for queries.
	 */
	async isReady(osmId: OsmId) {
		try {
			await Promise.all(
				this.workers.map(async (worker) => {
					const isReady = await worker.isReady(this.getId(osmId))
					if (!isReady) throw Error("Osm instance is not ready")
				}),
			)
		} catch {
			return false
		}
		return true
	}

	/**
	 * Check if an `Osm` instance exists in any worker.
	 */
	has(osmId: OsmId) {
		return this.nextWorker().has(this.getId(osmId))
	}

	/**
	 * Retrieve an `Osm` instance from a worker and reconstruct it on the main thread.
	 * Useful for direct access when worker overhead is unnecessary.
	 */
	async get(osmId: OsmId): Promise<Osm> {
		const transferables = await this.nextWorker().getOsmBuffers(
			this.getId(osmId),
		)
		return new Osm(transferables)
	}

	/**
	 * Transfer an `Osm` instance from workers back to the main thread and remove it from workers.
	 * Useful for final cleanup or moving data out of worker context.
	 */
	async transferOut(osmId: OsmId): Promise<Osm> {
		const transferables = await this.nextWorker().transferOut(this.getId(osmId))
		await this.delete(osmId)
		return new Osm(transferables)
	}

	/**
	 * Transfer an `Osm` instance from the main thread into all workers.
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
	 * Remove an `Osm` instance from all workers, freeing its memory.
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
	 * Search for `Osm` entities by tag key and optional value.
	 * Delegates to an available worker for off-thread search.
	 */
	search(osmId: OsmId, key: string, val?: string) {
		return this.nextWorker().search(this.getId(osmId), key, val)
	}

	// ---------------------------------------------------------------------------
	// Routing
	// ---------------------------------------------------------------------------

	/**
	 * Synchronize a routing graph from one worker to all others using SharedArrayBuffer.
	 * No-op if SharedArrayBuffer is unsupported (single-worker mode).
	 */
	private async populateRoutingGraphToOtherWorkers(
		worker: Comlink.Remote<OsmixWorker>,
		osmId: OsmId,
	) {
		if (!SUPPORTS_SHARED_ARRAY_BUFFER) return
		const transferables = await worker.getRoutingGraphTransferables(
			this.getId(osmId),
		)
		await Promise.all(
			this.workers.map((w) =>
				w.transferRoutingGraphIn(this.getId(osmId), transferables),
			),
		)
	}

	/**
	 * Build a routing graph for an Osm instance in a worker.
	 * Graph is built in the first available worker, then synchronized across all workers.
	 *
	 * @param osmId - ID of the Osm instance to build a graph for.
	 * @param filter - Optional filter function to determine which ways are routable.
	 * @param defaultSpeeds - Optional speed limits by highway type.
	 * @returns Graph statistics (node and edge counts).
	 */
	async buildRoutingGraph(
		osmId: OsmId,
		filter?: HighwayFilter,
		defaultSpeeds?: DefaultSpeeds,
	) {
		const worker0 = this.nextWorker()
		const stats = await worker0.buildRoutingGraph(
			this.getId(osmId),
			filter,
			defaultSpeeds,
		)
		await this.populateRoutingGraphToOtherWorkers(worker0, osmId)
		return stats
	}

	/**
	 * Check if a routing graph exists for an Osm instance.
	 */
	hasRoutingGraph(osmId: OsmId) {
		return this.nextWorker().hasRoutingGraph(this.getId(osmId))
	}

	/**
	 * Find the nearest routable node to a geographic point.
	 * Delegates to an available worker for off-thread computation.
	 *
	 * @param osmId - ID of the Osm instance.
	 * @param point - [lon, lat] coordinates to search from.
	 * @param maxDistanceM - Maximum search radius in meters.
	 * @returns Nearest routable node info, or null if none found.
	 */
	findNearestRoutableNode(osmId: OsmId, point: LonLat, maxDistanceM: number) {
		return this.nextWorker().findNearestRoutableNode(
			this.getId(osmId),
			point,
			maxDistanceM,
		)
	}

	/**
	 * Calculate a route between two node indexes.
	 * Delegates to an available worker for off-thread pathfinding.
	 *
	 * @param osmId - ID of the Osm instance.
	 * @param fromIndex - Starting node index.
	 * @param toIndex - Destination node index.
	 * @param options - Optional routing options (algorithm, metric).
	 * @returns Route result with coordinates and way info, or null if no route found.
	 */
	route(
		osmId: OsmId,
		fromIndex: number,
		toIndex: number,
		options?: Partial<RouteOptions>,
	): Promise<RouteResult | null> {
		return this.nextWorker().route(
			this.getId(osmId),
			fromIndex,
			toIndex,
			options,
		)
	}

	// ---------------------------------------------------------------------------
	// Merge & Changesets
	// ---------------------------------------------------------------------------

	/**
	 * Merge two `Osm` instances in a worker.
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
	 * Generate a changeset comparing base and patch `Osm` instances in the changeset worker.
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
	 * Apply the active changeset to its base `Osm` instance and replace it with the result.
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
