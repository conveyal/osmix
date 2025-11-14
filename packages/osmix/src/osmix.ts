import { Osm, type OsmOptions } from "@osmix/core"
import { startCreateOsmFromGeoJSON } from "@osmix/geojson"
import { DEFAULT_RASTER_TILE_SIZE } from "@osmix/raster"
import { progressEvent } from "@osmix/shared/progress"
import type { OsmNode, OsmRelation, OsmWay, Tile } from "@osmix/shared/types"
import { OsmixVtEncoder } from "@osmix/vt"
import { type OsmFromPbfOptions, startCreateOsmFromPbf } from "./pbf"
import { drawRasterTile } from "./raster"

export interface IOsmix {
	fromPbf(
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmFromPbfOptions>,
	): Promise<Osm>
	fromGeoJSON(
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmOptions>,
	): Promise<Osm>
	isReady(osm: string | Osm): boolean
	get(id: string): Osm
	set(id: string, osm: Osm): void
	delete(id: string): void
	getVectorTile(osm: string | Osm, tile: Tile): ArrayBuffer
	getRasterTile(osm: string | Osm, tile: Tile, tileSize: number): ArrayBuffer
	search(
		id: string,
		key: string,
		val?: string,
	): { nodes: OsmNode[]; ways: OsmWay[]; relations: OsmRelation[] }
}

export class Osmix extends EventTarget implements IOsmix {
	private osm: Record<string, Osm> = {}
	private vtEncoders: Record<string, OsmixVtEncoder> = {}

	log(message: string) {
		this.dispatchEvent(progressEvent(message))
	}

	async fromPbf(
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmFromPbfOptions> = {},
	): Promise<Osm> {
		const osm = new Osm(options)
		for await (const update of startCreateOsmFromPbf(
			osm,
			data instanceof ReadableStream ? data : new Uint8Array(data),
			options,
		)) {
			this.dispatchEvent(update)
		}
		this.set(osm.id, osm)
		return osm
	}

	async fromGeoJSON(
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
		const osm = new Osm(options)
		for (const update of startCreateOsmFromGeoJSON(osm, geojson)) {
			this.dispatchEvent(update)
		}
		this.set(osm.id, osm)
		return osm
	}

	isReady(id: string): boolean {
		if (!this.osm[id]) return false
		return this.osm[id].isReady()
	}

	get(id: string | Osm): Osm {
		if (typeof id === "string") {
			if (!this.osm[id]) throw Error(`OSM not found for id: ${id}`)
			return this.osm[id]
		}
		return id
	}

	set(id: string, osm: Osm) {
		this.osm[id] = osm
	}

	delete(osm: string | Osm) {
		const id = typeof osm === "string" ? osm : osm.id
		delete this.osm[id]
		delete this.vtEncoders[id]
	}

	getVtEncoder(osmId: string | Osm) {
		const osm = this.get(osmId)
		if (!this.vtEncoders[osm.id])
			this.vtEncoders[osm.id] = new OsmixVtEncoder(osm)
		return this.vtEncoders[osm.id]!
	}

	getVectorTile(osmId: string | Osm, tile: Tile) {
		return this.getVtEncoder(osmId).getTile(tile)
	}

	getRasterTile(
		osmId: string | Osm,
		tile: Tile,
		tileSize = DEFAULT_RASTER_TILE_SIZE,
	) {
		return drawRasterTile(this.get(osmId), tile, tileSize)
	}

	search(
		osmId: string | Osm,
		key: string,
		val?: string,
	): { nodes: OsmNode[]; ways: OsmWay[]; relations: OsmRelation[] } {
		const osm = this.get(osmId)
		const nodes = osm.nodes.search(key, val)
		const ways = osm.ways.search(key, val)
		const relations = osm.relations.search(key, val)
		return { nodes, ways, relations }
	}
}
