import type { OsmChangeTypes, OsmMergeOptions } from "@osmix/change"
import { Osm, type OsmInfo, type OsmOptions } from "@osmix/core"
import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import { DEFAULT_RASTER_TILE_SIZE } from "@osmix/raster"
import type { Progress } from "@osmix/shared/progress"
import { streamToBytes } from "@osmix/shared/stream-to-bytes"
import type { GeoBbox2D, OsmEntityType, Tile } from "@osmix/shared/types"
import * as Comlink from "comlink"
import type { OsmixWorker } from "./osmix.worker"
import { type OsmFromPbfOptions, osmToPbfStream } from "./pbf"
import {
	DEFAULT_WORKER_COUNT,
	SUPPORTS_SHARED_ARRAY_BUFFER,
	SUPPORTS_STREAM_TRANSFER,
	transfer,
} from "./utils"

type OsmId = string | Osm

type Remoteify<T> = T extends (...args: infer A) => infer R
	? (...args: A) => Promise<Awaited<R>>
	: T extends object
		? {
				[K in keyof T]: Remoteify<T[K]>
			}
		: Promise<T>

export type RemoteOsm = Remoteify<Osm> & {
	id: string
	header: OsmPbfHeaderBlock
	bbox: GeoBbox2D
	stats: OsmInfo
}

export interface OsmixRemoteOptions {
	workerCount?: number
	onProgress?: (progress: Progress) => void
}

/**
 * Manage data access across one or more workers while using the same API as a local Osmix instance.
 */
export class OsmixRemote {
	private workers: Comlink.Remote<OsmixWorker>[] = []
	private changesetWorker: Comlink.Remote<OsmixWorker> | null = null

	static async connect({
		workerCount = DEFAULT_WORKER_COUNT,
		onProgress,
	}: OsmixRemoteOptions = {}) {
		const remote = new OsmixRemote()
		if (workerCount < 1) throw Error("Worker count must be at least 1")
		if (workerCount > 1 && !SUPPORTS_SHARED_ARRAY_BUFFER)
			throw Error(
				"SharedArrayBuffer not supported, cannot use multiple workers.",
			)
		for (let i = 0; i < workerCount; i++) {
			const worker = await createOsmixWorker()
			if (onProgress) {
				await worker.addProgressListener(Comlink.proxy(onProgress))
			}
			remote.workers.push(worker)
		}
		remote.changesetWorker = remote.workers[0]!
		return remote
	}

	private getWorker() {
		const nextWorker = this.workers.shift()
		if (!nextWorker) throw Error("No worker available")
		this.workers.push(nextWorker)
		return nextWorker
	}

	/**
	 * Changesets must always be handled by the same worker.
	 */
	private getChangesetWorker() {
		if (!this.changesetWorker) throw Error("No changeset worker available")
		return this.changesetWorker
	}

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

	private async populateWorkers(osmId: string) {
		if (!SUPPORTS_SHARED_ARRAY_BUFFER) return
		const osmBuffers = await this.getWorker().getOsmBuffers(osmId)
		await Promise.all(
			this.workers.map((worker) => worker.transferIn(osmBuffers)),
		)
	}

	async fromPbf(
		data: ArrayBufferLike | ReadableStream | Uint8Array | File,
		options: Partial<OsmFromPbfOptions> = {},
	) {
		const workers = this.workers.slice()
		const worker0 = workers.shift()!
		const osmInfo = await worker0.fromPbf(
			transfer({ data: await this.getTransferableData(data), options }),
		)
		await this.populateWorkers(osmInfo.id)
		return osmInfo
	}

	toPbfStream(osmId: OsmId, writeableStream: WritableStream<Uint8Array>) {
		if (!SUPPORTS_STREAM_TRANSFER) throw Error("Stream transfer not supported")
		return this.getWorker().toPbfStream(
			Comlink.transfer({ osmId: this.getId(osmId), writeableStream }, [
				writeableStream,
			]),
		)
	}

	toPbfData(osmId: OsmId) {
		return this.getWorker().toPbf(this.getId(osmId))
	}

	async toPbf(osmId: OsmId, stream: WritableStream<Uint8Array>) {
		if (SUPPORTS_STREAM_TRANSFER) return this.toPbfStream(osmId, stream)
		const osm = await this.get(osmId)
		return osmToPbfStream(osm).pipeTo(stream)
	}

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
		await this.populateWorkers(osmInfo.id)
		return osmInfo
	}

	async fromFile(file: File, options: Partial<OsmOptions> = {}) {
		const fileName = file.name.toLowerCase()
		const isGeoJSON =
			fileName.endsWith(".geojson") || fileName.endsWith(".json")
		return isGeoJSON
			? this.fromGeoJSON(file, { ...options, id: options.id ?? file.name })
			: this.fromPbf(file, { ...options, id: options.id ?? file.name })
	}

	async readHeader(data: ArrayBuffer | ReadableStream | Uint8Array | File) {
		return this.getWorker().readHeader(await this.getTransferableData(data))
	}

	getId(osmId: OsmId) {
		if (typeof osmId === "string") {
			return osmId
		}
		return osmId.id
	}

	isReady(osmId: OsmId) {
		return this.getWorker().isReady(this.getId(osmId))
	}

	has(osmId: OsmId) {
		return this.getWorker().has(this.getId(osmId))
	}

	async get(osmId: OsmId): Promise<Osm> {
		const transferables = await this.getWorker().getOsmBuffers(
			this.getId(osmId),
		)
		return new Osm(transferables)
	}

	getProxy(osmId: OsmId): RemoteOsm {
		return this.createProxy(this.getId(osmId))
	}

	async transferOut(osmId: OsmId): Promise<Osm> {
		const transferables = await this.getWorker().transferOut(this.getId(osmId))
		await this.delete(osmId)
		return new Osm(transferables)
	}

	async transferIn(osm: Osm): Promise<void> {
		await Promise.all(
			this.workers.map((worker) =>
				worker.transferIn(transfer(osm.transferables())),
			),
		)
	}

	async delete(osmId: OsmId): Promise<void> {
		await Promise.all(
			this.workers.map((worker) => worker.delete(this.getId(osmId))),
		)
	}

	getVectorTile(osmId: OsmId, tile: Tile) {
		return this.getWorker().getVectorTile(this.getId(osmId), tile)
	}

	getRasterTile(osmId: OsmId, tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		return this.getWorker().getRasterTile(this.getId(osmId), tile, tileSize)
	}

	search(osmId: OsmId, key: string, val?: string) {
		return this.getWorker().search(this.getId(osmId), key, val)
	}

	async merge(
		baseOsmId: OsmId,
		patchOsmId: OsmId,
		options: Partial<OsmMergeOptions> = {},
	) {
		const osmId = await this.getWorker().merge(
			this.getId(baseOsmId),
			this.getId(patchOsmId),
			options,
		)
		return osmId
	}

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

	async applyChangesAndReplace(osmId: OsmId) {
		return this.getChangesetWorker().applyChangesAndReplace(this.getId(osmId))
	}

	setChangesetFilters(
		changeTypes: OsmChangeTypes[],
		entityTypes: OsmEntityType[],
	) {
		this.getChangesetWorker().setChangesetFilters(changeTypes, entityTypes)
	}

	getChangesetPage(osmId: OsmId, page: number, pageSize: number) {
		return this.getChangesetWorker().getChangesetPage(
			this.getId(osmId),
			page,
			pageSize,
		)
	}

	private createProxy(id: string): RemoteOsm {
		const getWorker = () => this.getWorker()

		const buildProxy = (path: string[]) =>
			new Proxy(() => {}, {
				get(_target, prop, _receiver) {
					// This is the magic: `await osm.nodes.size`
					// turns into fetching the `then` property on this proxy.
					if (prop === "then") {
						return (
							resolve: (v: unknown) => void,
							reject: (err: unknown) => void,
						) => {
							// callOsm will either invoke a method or return a plain property
							getWorker().callOsmViaProxy(id, path, []).then(resolve, reject)
						}
					}

					if (typeof prop === "symbol") {
						return undefined
					}

					// Continue building the path: osm.nodes, osm.nodes.size, ...
					return buildProxy([...path, String(prop)])
				},

				async apply(_target, _thisArg, argArray) {
					if (path.length === 0) {
						throw new Error("Cannot call the root proxy directly")
					}
					// Method call: osm.nodes.findIndexesWithinBbox(...)
					return getWorker().callOsmViaProxy(id, path, argArray)
				},
			})

		return buildProxy([]) as unknown as RemoteOsm
	}
}

/**
 * Create a single OsmixWorker instance.
 */
export async function createOsmixWorker(): Promise<
	Comlink.Remote<OsmixWorker>
> {
	if (typeof Worker === "undefined") {
		throw Error("Worker not supported")
	}
	const worker = new Worker(new URL("./osmix.worker.ts", import.meta.url), {
		type: "module",
	})
	return Comlink.wrap<OsmixWorker>(worker)
}
