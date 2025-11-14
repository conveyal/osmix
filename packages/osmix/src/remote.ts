import { Osm, type OsmOptions } from "@osmix/core"
import { DEFAULT_RASTER_TILE_SIZE } from "@osmix/raster"
import type { Progress } from "@osmix/shared/progress"
import { streamToBytes } from "@osmix/shared/stream-to-bytes"
import type { Tile } from "@osmix/shared/types"
import * as Comlink from "comlink"
import type { IOsmix } from "./osmix"
import type { OsmixWorker } from "./osmix.worker"
import type { OsmFromPbfOptions } from "./pbf"
import { transfer } from "./utils"

type WrapNonPromiseInPromise<T> = T extends Promise<infer _U> ? T : Promise<T>

type Promisify<T> = {
	[K in keyof T]: T[K] extends (...args: infer _Args) => infer _ReturnType
		? (...args: Parameters<T[K]>) => WrapNonPromiseInPromise<ReturnType<T[K]>>
		: T[K]
}

/**
 * Manage data access across one or more workers while using the same API as a local Osmix instance.
 */
export class OsmixRemote implements Promisify<IOsmix> {
	private workers: Comlink.Remote<OsmixWorker>[] = []

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
		return remote
	}

	getWorker() {
		const nextWorker = this.workers.shift()
		if (!nextWorker) throw Error("No worker available")
		this.workers.push(nextWorker)
		return nextWorker
	}

	async fromPbf(
		id: string,
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmFromPbfOptions> = {},
	) {
		const dataBuffer =
			data instanceof ReadableStream ? (await streamToBytes(data)).buffer : data
		const workers = this.workers.slice()
		const worker0 = workers.shift()!
		const transferables = await worker0.fromPbf(
			transfer({ id, data: dataBuffer, options }),
		)
		await Promise.all(
			workers.map((worker) => worker.fromTransferables(transferables)),
		)
		return new Osm(transferables)
	}

	async fromGeoJSON(
		id: string,
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmOptions> = {},
	) {
		const dataBuffer =
			data instanceof ReadableStream ? (await streamToBytes(data)).buffer : data

		const workers = this.workers.slice()
		const worker0 = workers.shift()!
		const transferables = await worker0.fromGeoJSON(
			transfer({
				id,
				data: dataBuffer,
				options,
			}),
		)
		await Promise.all(
			workers.map((worker) => worker.fromTransferables(transferables)),
		)
		return new Osm(transferables)
	}

	isReady(id: string) {
		return this.getWorker().isReady(id)
	}

	async get(id: string): Promise<Osm> {
		const transferables = await this.getWorker().get(id)
		return new Osm(transferables)
	}

	set(id: string, osm: Osm): Promise<void> {
		return this.getWorker().set(id, osm.transferables())
	}

	delete(id: string): Promise<void> {
		return this.getWorker().delete(id)
	}

	getVectorTile(id: string, tile: Tile) {
		return this.getWorker().getVectorTile(id, tile)
	}

	getRasterTile(id: string, tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		return this.getWorker().getRasterTile(id, tile, tileSize)
	}

	search(id: string, key: string, val?: string) {
		return this.getWorker().search(id, key, val)
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
