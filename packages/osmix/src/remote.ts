import {
	Osm,
	type OsmCreateFromGeoJSONOptions,
	type OsmFromPbfOptions,
} from "@osmix/core"
import { DEFAULT_RASTER_TILE_SIZE } from "@osmix/raster"
import { streamToBytes } from "@osmix/shared/stream-to-bytes"
import type { Tile } from "@osmix/shared/types"
import * as Comlink from "comlink"
import type { IOsmix } from "./osmix"
import type { OsmixWorker } from "./osmix.worker"

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
	private logger: (message: string) => void = console.log
	private workerCount = 1

	static async connect() {
		const remote = new OsmixRemote()
		for (let i = 0; i < remote.workerCount; i++) {
			remote.workers.push(await createOsmixWorker())
		}
		return remote
	}

	constructor(
		workerCount = 1,
		logger: (message: string) => void = console.log,
	) {
		this.logger = logger
		this.workerCount = workerCount
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
		console.error("FROMPBF", id, data, options)
		const transferables = await this.getWorker().fromPbf(
			Comlink.transfer({ id, data }, [data]),
		)
		return new Osm(transferables)
	}

	async fromGeoJSON(
		id: string,
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmCreateFromGeoJSONOptions> = {},
	) {
		// Convert ReadableStream to ArrayBuffer for transfer
		const transferData =
			data instanceof ReadableStream ? (await streamToBytes(data)).buffer : data

		const transferables = await this.getWorker().fromGeoJSON(
			id,
			transferData,
			options,
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
