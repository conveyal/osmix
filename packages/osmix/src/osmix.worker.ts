import { Osm, type OsmOptions, type OsmTransferables } from "@osmix/core"
import { DEFAULT_RASTER_TILE_SIZE } from "@osmix/raster"
import type { Progress, ProgressEvent } from "@osmix/shared/progress"
import type { Tile } from "@osmix/shared/types"
import * as Comlink from "comlink"
import { Osmix } from "./osmix"
import type { OsmFromPbfOptions } from "./pbf"
import { collectTransferables } from "./utils"

/**
 * Worker handler for a single Osmix instance.
 */
export class OsmixWorker {
	private osmix = new Osmix()

	addProgressListener(listener: (progress: Progress) => void) {
		this.osmix.addEventListener("progress", (e: Event) =>
			listener((e as ProgressEvent).detail),
		)
	}

	async fromPbf({
		id,
		data,
		options,
	}: {
		id: string
		data: ArrayBufferLike | ReadableStream
		options?: Partial<OsmFromPbfOptions>
	}) {
		const osm = await this.osmix.fromPbf(id, data, options)
		return osm.transferables()
	}

	async fromGeoJSON({
		id,
		data,
		options,
	}: {
		id: string
		data: ArrayBufferLike | ReadableStream
		options?: Partial<OsmOptions>
	}) {
		const osm = await this.osmix.fromGeoJSON(id, data, options)
		return osm.transferables()
	}

	fromTransferables(transferables: OsmTransferables) {
		this.osmix.set(transferables.id, new Osm(transferables))
	}

	transfer(id: string) {
		const transferables = this.osmix.get(id).transferables()
		return Comlink.transfer(transferables, collectTransferables(transferables))
	}

	isReady(id: string): boolean {
		return this.osmix.isReady(id)
	}

	get(id: string) {
		return this.osmix.get(id).transferables()
	}

	set(id: string, transferables: OsmTransferables) {
		this.osmix.set(id, new Osm(transferables))
	}

	delete(id: string) {
		this.osmix.delete(id)
	}

	getVectorTile(id: string, tile: Tile) {
		const data = this.osmix.getVectorTile(id, tile)
		if (!data || data.byteLength === 0) return new ArrayBuffer(0)
		return Comlink.transfer(data, [data])
	}

	getRasterTile(id: string, tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		const data = this.osmix.getRasterTile(id, tile, tileSize)
		if (!data || data.byteLength === 0) return new ArrayBuffer(0)
		return Comlink.transfer(data, [data])
	}

	search(id: string, key: string, val?: string) {
		return this.osmix.search(id, key, val)
	}
}

Comlink.expose(new OsmixWorker())
