/**
 * Web Worker implementation for OSM operations.
 *
 * OsmixWorker runs inside a Web Worker and manages multiple Osm instances.
 * It exposes methods via Comlink for cross-thread RPC from OsmixRemote.
 *
 * Can be extended to add custom functionality:
 * @example
 * ```ts
 * class MyWorker extends OsmixWorker {
 *   myCustomMethod(osmId: string) {
 *     const osm = this.get(osmId)
 *     // ... custom logic
 *   }
 * }
 * ```
 *
 * @module
 */

import {
	applyChangesetToOsm,
	generateChangeset,
	merge,
	type OsmChange,
	type OsmChangeset,
	type OsmChangeTypes,
	type OsmMergeOptions,
} from "@osmix/change"
import { Osm, type OsmOptions, type OsmTransferables } from "@osmix/core"
import { fromGeoJSON } from "@osmix/geojson"
import { fromGeoParquet, type GeoParquetReadOptions } from "@osmix/geoparquet"
import { DEFAULT_RASTER_TILE_SIZE } from "@osmix/raster"
import {
	type DefaultSpeeds,
	type HighwayFilter,
	type RouteOptions,
	type RouteResult,
	Router,
	RoutingGraph,
	type RoutingGraphTransferables,
	type WaySegment,
} from "@osmix/router"
import { fromShapefile } from "@osmix/shapefile"
import type { Progress, ProgressEvent } from "@osmix/shared/progress"
import type { LonLat, OsmEntityType, Tile } from "@osmix/shared/types"

// Re-export types from router for backwards compatibility
export type { RouteResult, WaySegment }

import { OsmixVtEncoder } from "@osmix/vt"
import * as Comlink from "comlink"
import { dequal } from "dequal/lite"
import {
	fromPbf,
	type OsmFromPbfOptions,
	readOsmPbfHeader,
	toPbfBuffer,
	toPbfStream,
} from "./pbf"
import { drawToRasterTile } from "./raster"
import { transfer } from "./utils"

/**
 * Worker handler for managing multiple Osm instances within a Web Worker.
 * Exposes Comlink-wrapped methods for off-thread Osm data operations.
 */
export class OsmixWorker extends EventTarget {
	private osm: Record<string, Osm> = {}
	private vtEncoders: Record<string, OsmixVtEncoder> = {}
	private graphs: Record<string, RoutingGraph> = {}
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
	 * Delegates to readHeader method.
	 */
	readHeader(data: ArrayBufferLike | ReadableStream) {
		return readOsmPbfHeader(
			data instanceof ReadableStream ? data : new Uint8Array(data),
		)
	}

	/**
	 * Load an Osm instance from PBF data and store it in this worker.
	 * Returns Osm metadata including entity counts and bbox.
	 */
	async fromPbf({
		data,
		options,
	}: {
		data: ArrayBufferLike | ReadableStream
		options?: Partial<OsmFromPbfOptions>
	}) {
		const osm = await fromPbf(
			data instanceof ReadableStream ? data : new Uint8Array(data),
			options,
			this.onProgress,
		)
		this.set(osm.id, osm)
		return osm.info()
	}

	/**
	 * Serialize an Osm instance to PBF and pipe into the provided writable stream.
	 * Stream is transferred from the main thread for zero-copy efficiency.
	 */
	toPbfStream({
		osmId,
		writeableStream,
	}: {
		osmId: string
		writeableStream: WritableStream<Uint8Array>
	}) {
		return toPbfStream(this.get(osmId)).pipeTo(writeableStream)
	}

	/**
	 * Serialize an Osm instance to a single PBF buffer.
	 * Result is transferred back to the main thread.
	 */
	async toPbf(osmId: string) {
		const data = await toPbfBuffer(this.get(osmId))
		return Comlink.transfer(data, [data.buffer])
	}

	/**
	 * Load an Osm instance from GeoJSON data and store it in this worker.
	 * Returns Osm metadata including entity counts and bbox.
	 */
	async fromGeoJSON({
		data,
		options,
	}: {
		data: ArrayBufferLike | ReadableStream
		options?: Partial<OsmOptions>
	}) {
		const osm = await fromGeoJSON(data, options, this.onProgress)
		this.set(osm.id, osm)
		return osm.info()
	}

	/**
	 * Load an Osm instance from Shapefile (ZIP) data and store it in this worker.
	 * Returns Osm metadata including entity counts and bbox.
	 */
	async fromShapefile({
		data,
		options,
	}: {
		data: ArrayBufferLike | ReadableStream
		options?: Partial<OsmOptions>
	}) {
		const osm = await fromShapefile(data, options, this.onProgress)
		this.set(osm.id, osm)
		return osm.info()
	}

	/**
	 * Load an Osm instance from GeoParquet data and store it in this worker.
	 * Returns Osm metadata including entity counts and bbox.
	 */
	async fromGeoParquet({
		data,
		options,
		readOptions,
	}: {
		data: ArrayBuffer | string | URL
		options?: Partial<OsmOptions>
		readOptions?: GeoParquetReadOptions
	}) {
		const osm = await fromGeoParquet(
			data,
			options,
			readOptions,
			this.onProgress,
		)
		this.set(osm.id, osm)
		return osm.info()
	}

	/**
	 * Accept transferables from another worker or main thread and reconstruct an Osm instance.
	 * Used when SharedArrayBuffer is supported to share data across workers.
	 */
	transferIn(transferables: OsmTransferables) {
		this.set(transferables.id, new Osm(transferables))
	}

	/**
	 * Transfer an Osm instance out of this worker and remove it.
	 * Transfers underlying buffers for efficient cross-thread movement.
	 */
	transferOut(id: string) {
		const transferables = this.get(id).transferables()
		this.delete(id)
		return transfer(transferables)
	}

	/**
	 * Get the raw transferable buffers for an Osm instance without removing it.
	 * Used to duplicate data across workers when SharedArrayBuffer is available.
	 */
	getOsmBuffers(id: string) {
		return this.get(id).transferables()
	}

	/**
	 * Check if an Osm instance with the given ID exists in this worker.
	 */
	has(id: string): boolean {
		return this.osm[id] != null
	}

	/**
	 * Check if an Osm instance has completed index building and is ready for queries.
	 */
	isReady(id: string): boolean {
		return this.osm[id]?.isReady() ?? false
	}

	/**
	 * Retrieve an Osm instance by ID, throwing if not found.
	 * Protected to allow subclasses to access stored Osmix instances.
	 */
	protected get(id: string) {
		if (!this.osm[id]) throw Error(`OSM not found for id: ${id}`)
		return this.osm[id]
	}

	/**
	 * Store an Osm instance by ID, replacing any existing instance with the same ID.
	 * Protected to allow subclasses to manage Osm instances. If a routing graph exists,
	 * rebuild it.
	 */
	protected set(id: string, osm: Osm) {
		this.osm[id] = osm
		this.vtEncoders[id] = new OsmixVtEncoder(osm)
		if (this.graphs[id]) {
			this.buildRoutingGraph(
				id,
				this.graphs[id].filter,
				this.graphs[id].defaultSpeeds,
			)
		}
	}

	/**
	 * Remove an Osm instance from this worker, freeing its memory.
	 */
	delete(id: string) {
		delete this.osm[id]
		delete this.vtEncoders[id]
		delete this.graphs[id]
	}

	// ---------------------------------------------------------------------------
	// Routing
	// ---------------------------------------------------------------------------

	/**
	 * Build a routing graph for an Osm instance.
	 * The graph is stored internally and can be shared via transferables.
	 *
	 * @param osmId - ID of the Osm instance to build a graph for.
	 * @param filter - Optional filter function to determine which ways are routable.
	 * @param defaultSpeeds - Optional speed limits by highway type.
	 * @returns Graph statistics (node and edge counts).
	 */
	buildRoutingGraph(
		osmId: string,
		filter?: HighwayFilter,
		defaultSpeeds?: DefaultSpeeds,
	) {
		const osm = this.get(osmId)
		const graph = new RoutingGraph(osm, filter, defaultSpeeds)
		this.graphs[osmId] = graph
		return { nodeCount: graph.size, edgeCount: graph.edges }
	}

	/**
	 * Check if a routing graph exists for an Osm instance.
	 */
	hasRoutingGraph(osmId: string): boolean {
		return this.graphs[osmId] != null
	}

	/**
	 * Get the routing graph for an Osm instance.
	 * Auto-builds the graph on first access if it doesn't exist.
	 * @throws If the graph cannot be built.
	 */
	protected getGraph(osmId: string): RoutingGraph {
		let graph = this.graphs[osmId]
		if (!graph) {
			// Auto-build on first access
			this.buildRoutingGraph(osmId)
			graph = this.graphs[osmId]
		}
		if (!graph) throw Error(`Failed to build routing graph for: ${osmId}`)
		return graph
	}

	/**
	 * Get routing graph transferables for sharing with other workers.
	 * @param osmId - ID of the Osm instance.
	 * @returns Transferable buffers for the routing graph.
	 */
	getRoutingGraphTransferables(osmId: string): RoutingGraphTransferables {
		return this.getGraph(osmId).transferables()
	}

	/**
	 * Accept a routing graph from another worker or main thread.
	 * Used to share pre-built graphs across workers.
	 *
	 * @param osmId - ID to associate with the graph.
	 * @param transferables - Routing graph transferables.
	 */
	transferRoutingGraphIn(
		osmId: string,
		transferables: RoutingGraphTransferables,
	) {
		this.graphs[osmId] = new RoutingGraph(transferables)
	}

	/**
	 * Find the nearest routable node to a geographic point.
	 *
	 * @param osmId - ID of the Osm instance.
	 * @param point - [lon, lat] coordinates to search from.
	 * @param maxDistanceM - Maximum search radius in meters.
	 * @returns Nearest routable node info, or null if none found.
	 */
	findNearestRoutableNode(osmId: string, point: LonLat, maxDistanceM: number) {
		return this.getGraph(osmId).findNearestRoutableNode(
			this.get(osmId),
			point,
			maxDistanceM,
		)
	}

	/**
	 * Calculate a route between two node indexes.
	 *
	 * @param osmId - ID of the Osm instance.
	 * @param fromIndex - Starting node index.
	 * @param toIndex - Destination node index.
	 * @param options - Optional routing options (algorithm, metric).
	 * @returns Route result with coordinates and way info, or null if no route found.
	 */
	route(
		osmId: string,
		fromIndex: number,
		toIndex: number,
		options?: Partial<RouteOptions>,
	): RouteResult | null {
		const osm = this.get(osmId)
		const graph = this.getGraph(osmId)
		const router = new Router(osm, graph, options)
		const path = router.route(fromIndex, toIndex, options)
		if (!path) return null
		return router.buildResult(path, options)
	}

	// ---------------------------------------------------------------------------
	// Vector & Raster Tiles
	// ---------------------------------------------------------------------------

	/**
	 * Generate a Mapbox Vector Tile for the specified tile coordinates.
	 * Returns transferred MVT data suitable for MapLibre rendering.
	 */
	getVectorTile(id: string, tile: Tile) {
		const data = this.vtEncoders[id]?.getTile(tile)
		if (!data || data.byteLength === 0) return new ArrayBuffer(0)
		return Comlink.transfer(data, [data])
	}

	/**
	 * Generate a raster tile as ImageData for the specified tile coordinates.
	 * Returns transferred RGBA pixel data suitable for canvas rendering.
	 */
	getRasterTile(id: string, tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		const data = drawToRasterTile(this.get(id), tile, tileSize).imageData
		if (!data || data.byteLength === 0) return new Uint8ClampedArray(0)
		return Comlink.transfer(data, [data.buffer])
	}

	/**
	 * Search for entities by tag key and optional value.
	 * Returns matching nodes, ways, and relations.
	 */
	search(id: string, key: string, val?: string) {
		const osm = this.get(id)
		const nodes = osm.nodes.search(key, val)
		const ways = osm.ways.search(key, val)
		const relations = osm.relations.search(key, val)
		return { nodes, ways, relations }
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
		this.set(baseOsmId, new Osm(mergedOsm.transferables()))
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
		const changeset = generateChangeset(
			this.get(baseOsmId),
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
		this.set(osmId, newOsm)
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
