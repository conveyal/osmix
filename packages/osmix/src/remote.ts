import type { OsmChangeTypes, OsmMergeOptions } from "@osmix/change"
import { Osm, type OsmOptions } from "@osmix/core"
import { DEFAULT_RASTER_TILE_SIZE, OsmixRasterTile } from "@osmix/raster"
import type { Progress } from "@osmix/shared/progress"
import { streamToBytes } from "@osmix/shared/stream-to-bytes"
import type { OsmEntityType, Tile } from "@osmix/shared/types"
import * as Comlink from "comlink"
import type { IOsmix } from "./osmix"
import type { OsmixWorker } from "./osmix.worker"
import type { OsmFromPbfOptions } from "./pbf"
import { supportsReadableStreamTransfer, transfer } from "./utils"

type WrapNonPromiseInPromise<T> = T extends Promise<infer _U> ? T : Promise<T>

type Promisify<T> = {
	[K in keyof T]: T[K] extends (...args: infer _Args) => infer _ReturnType
		? (...args: Parameters<T[K]>) => WrapNonPromiseInPromise<ReturnType<T[K]>>
		: T[K]
}

const SUPPORTS_READABLE_STREAM_TRANSFER = supportsReadableStreamTransfer()

/**
 * Manage data access across one or more workers while using the same API as a local Osmix instance.
 *
 * TODO make the returned Osm an OsmRemote Proxy that calls methods inside the remote worker.
 */
export class OsmixRemote implements Promisify<IOsmix> {
	private workers: Comlink.Remote<OsmixWorker>[] = []
	private changesetWorker: Comlink.Remote<OsmixWorker> | null = null

	static async connect(
		workerCount = 1,
		onProgress?: (progress: Progress) => void,
	) {
		const remote = new OsmixRemote()
		if (workerCount < 1) throw Error("Worker count must be at least 1")
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

	getWorker() {
		const nextWorker = this.workers.shift()
		if (!nextWorker) throw Error("No worker available")
		this.workers.push(nextWorker)
		return nextWorker
	}

	getChangesetWorker() {
		if (!this.changesetWorker) throw Error("No changeset worker available")
		return this.changesetWorker
	}

	async getTransferableData(
		data: ArrayBufferLike | ReadableStream | Uint8Array | File,
	) {
		if (data instanceof ArrayBuffer) return data
		if (data instanceof SharedArrayBuffer) return data
		if (data instanceof Uint8Array) return data.buffer
		if (data instanceof ReadableStream) {
			if (SUPPORTS_READABLE_STREAM_TRANSFER) return data
			return (await streamToBytes(data)).buffer
		}
		if (data instanceof File) {
			if (SUPPORTS_READABLE_STREAM_TRANSFER) return data.stream()
			return data.arrayBuffer()
		}
		throw Error("Invalid data")
	}

	async fromPbf(
		data: ArrayBufferLike | ReadableStream | Uint8Array | File,
		options: Partial<OsmFromPbfOptions> = {},
	) {
		const workers = this.workers.slice()
		const worker0 = workers.shift()!
		const transferables = await worker0.fromPbf(
			transfer({ data: await this.getTransferableData(data), options }),
		)
		await Promise.all(
			workers.map((worker) => worker.fromTransferables(transferables)),
		)
		return new Osm(transferables)
	}

	async fromGeoJSON(
		data: ArrayBufferLike | ReadableStream | Uint8Array | File,
		options: Partial<OsmOptions> = {},
	) {
		const workers = this.workers.slice()
		const worker0 = workers.shift()!
		const transferables = await worker0.fromGeoJSON(
			transfer({
				data: await this.getTransferableData(data),
				options,
			}),
		)
		await Promise.all(
			workers.map((worker) => worker.fromTransferables(transferables)),
		)
		return new Osm(transferables)
	}

	async readHeader(data: ArrayBuffer | ReadableStream | Uint8Array | File) {
		return this.getWorker().readHeader(await this.getTransferableData(data))
	}

	getId(osmId: string | Osm) {
		if (typeof osmId === "string") {
			return osmId
		}
		return osmId.id
	}

	isReady(osmId: string | Osm) {
		return this.getWorker().isReady(this.getId(osmId))
	}

	async get(osmId: string | Osm): Promise<Osm> {
		const transferables = await this.getWorker().get(this.getId(osmId))
		return new Osm(transferables)
	}

	set(id: string, osm: Osm): Promise<void> {
		return this.getWorker().set(id, osm.transferables())
	}

	delete(id: string): Promise<void> {
		return this.getWorker().delete(id)
	}

	getVectorTile(osmId: string | Osm, tile: Tile) {
		return this.getWorker().getVectorTile(this.getId(osmId), tile)
	}

	async getRasterTile(
		osmId: string | Osm,
		tile: Tile,
		tileSize = DEFAULT_RASTER_TILE_SIZE,
	) {
		const imageData = await this.getWorker().getRasterTile(
			this.getId(osmId),
			tile,
			tileSize,
		)
		return new OsmixRasterTile({ imageData, tile, tileSize })
	}

	search(osmId: string | Osm, key: string, val?: string) {
		return this.getWorker().search(this.getId(osmId), key, val)
	}

	async merge(
		baseOsmId: string | Osm,
		patchOsmId: string | Osm,
		options: Partial<OsmMergeOptions> = {},
	) {
		const transferables = await this.getWorker().merge(
			this.getId(baseOsmId),
			this.getId(patchOsmId),
			options,
		)
		return new Osm(transferables)
	}

	async generateChangeset(
		baseOsmId: string | Osm,
		patchOsmId: string | Osm,
		options: Partial<OsmMergeOptions> = {},
	) {
		return this.getChangesetWorker().generateChangeset(
			this.getId(baseOsmId),
			this.getId(patchOsmId),
			options,
		)
	}

	async applyChangesAndReplace(osmId: string | Osm) {
		const transferables =
			await this.getChangesetWorker().applyChangesAndReplace(this.getId(osmId))
		return new Osm(transferables)
	}

	setChangesetFilters(
		changeTypes: OsmChangeTypes[],
		entityTypes: OsmEntityType[],
	) {
		this.getChangesetWorker().setChangesetFilters(changeTypes, entityTypes)
	}

	getChangesetPage(osmId: string | Osm, page: number, pageSize: number) {
		return this.getChangesetWorker().getChangesetPage(
			this.getId(osmId),
			page,
			pageSize,
		)
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
