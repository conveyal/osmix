import {
	Osm,
	type OsmFromPbfOptions,
	type OsmOptions,
	startCreateOsmFromPbf,
} from "@osmix/core"
import { startCreateOsmFromGeoJSON } from "@osmix/geojson"
import { DEFAULT_RASTER_TILE_SIZE } from "@osmix/raster"
import type { OsmNode, OsmRelation, OsmWay, Tile } from "@osmix/shared/types"
import { OsmixVtEncoder } from "@osmix/vt"
import { drawRasterTile } from "./raster"

export interface IOsmix {
	fromPbf(
		id: string,
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmFromPbfOptions>,
	): Promise<Osm>
	fromGeoJSON(
		id: string,
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmOptions>,
	): Promise<Osm>
	isReady(id: string): boolean
	get(id: string): Osm
	set(id: string, osm: Osm): void
	delete(id: string): void
	getVectorTile(id: string, tile: Tile): ArrayBuffer
	getRasterTile(id: string, tile: Tile, tileSize: number): ArrayBuffer
	search(
		id: string,
		key: string,
		val?: string,
	): { nodes: OsmNode[]; ways: OsmWay[]; relations: OsmRelation[] }
}

export class Osmix extends EventTarget implements IOsmix {
	private osm: Record<string, Osm> = {}
	private vtEncoders: Record<string, OsmixVtEncoder> = {}

	async fromPbf(
		id: string,
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmFromPbfOptions> = {},
	): Promise<Osm> {
		const osm = new Osm({ ...options, id })
		for await (const update of startCreateOsmFromPbf(
			osm,
			data instanceof ReadableStream ? data : new Uint8Array(data),
			options,
		)) {
			this.dispatchEvent(update)
		}
		this.osm[id] = osm
		return osm
	}

	async fromGeoJSON(
		id: string,
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmOptions> = {},
	) {
		// Read the data as text
		let text: string
		if (data instanceof ReadableStream) {
			const reader = data.getReader()
			const decoder = new TextDecoder()
			let result = ""
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				result += decoder.decode(value, { stream: true })
			}
			// Flush any remaining bytes in the decoder's internal buffer
			result += decoder.decode()
			text = result
		} else {
			const decoder = new TextDecoder()
			text = decoder.decode(new Uint8Array(data))
		}

		// Parse JSON
		const geojson = JSON.parse(text) as GeoJSON.FeatureCollection<
			GeoJSON.Point | GeoJSON.LineString
		>
		const osm = new Osm({ ...options, id })
		for (const update of startCreateOsmFromGeoJSON(osm, geojson)) {
			this.dispatchEvent(update)
		}
		this.osm[id] = osm
		return osm
	}

	isReady(id: string): boolean {
		if (!this.osm[id]) return false
		return this.osm[id].isReady()
	}

	get(id: string): Osm {
		if (!this.osm[id]) throw Error(`OSM not found for id: ${id}`)
		return this.osm[id]
	}

	set(id: string, osm: Osm) {
		this.osm[id] = osm
	}

	delete(id: string) {
		delete this.osm[id]
		delete this.vtEncoders[id]
	}

	getVectorTile(id: string, tile: Tile) {
		if (!this.vtEncoders[id])
			this.vtEncoders[id] = new OsmixVtEncoder(this.get(id))
		return this.vtEncoders[id].getTile(tile)
	}

	getRasterTile(id: string, tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		return drawRasterTile(this.get(id), tile, tileSize)
	}

	search(
		id: string,
		key: string,
		val?: string,
	): { nodes: OsmNode[]; ways: OsmWay[]; relations: OsmRelation[] } {
		const osm = this.get(id)
		const nodes = osm.nodes.search(key, val)
		const ways = osm.ways.search(key, val)
		const relations = osm.relations.search(key, val)
		return { nodes, ways, relations }
	}
}
