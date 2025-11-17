import { Osm, type OsmOptions } from "@osmix/core"
import { startCreateOsmFromGeoJSON } from "@osmix/geojson"
import { readOsmPbf } from "@osmix/pbf"
import { DEFAULT_RASTER_TILE_SIZE, OsmixRasterTile } from "@osmix/raster"
import { progressEvent } from "@osmix/shared/progress"
import type { OsmNode, OsmRelation, OsmWay, Tile } from "@osmix/shared/types"
import { OsmixVtEncoder } from "@osmix/vt"
import {
	type OsmFromPbfOptions,
	osmToPbfBuffer,
	osmToPbfStream,
	startCreateOsmFromPbf,
} from "./pbf"
import { drawRasterTile } from "./raster"

export class Osmix extends EventTarget {
	log(message: string) {
		this.dispatchEvent(progressEvent(message))
	}

	async readHeader(data: Parameters<typeof readOsmPbf>[0]) {
		const { header } = await readOsmPbf(data)
		return header
	}

	async fromPbf(
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmFromPbfOptions> = {},
	): Promise<Osm> {
		const createOsm = startCreateOsmFromPbf(
			data instanceof ReadableStream ? data : new Uint8Array(data),
			options,
		)
		for await (const update of createOsm) {
			this.dispatchEvent(update)
		}
		const result = await createOsm.next()
		if (!result.done) throw Error("Failed to create Osm from PBF")
		return result.value
	}

	toPbfStream(osm: Osm): ReadableStream<Uint8Array> {
		return osmToPbfStream(osm)
	}

	async toPbf(osm: Osm): Promise<Uint8Array> {
		return osmToPbfBuffer(osm)
	}

	async fromGeoJSON(
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmOptions> = {},
	) {
		const geojson = await readGeoJSON(data)
		const osm = new Osm(options)
		for (const update of startCreateOsmFromGeoJSON(osm, geojson)) {
			this.dispatchEvent(update)
		}
		return osm
	}

	createVtEncoder(osm: Osm) {
		return new OsmixVtEncoder(osm)
	}

	getVectorTile(osm: Osm, tile: Tile) {
		return this.createVtEncoder(osm).getTile(tile)
	}

	getRasterTile(osm: Osm, tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		return drawRasterTile(osm, new OsmixRasterTile({ tile, tileSize }))
			.imageData
	}

	search(
		osm: Osm,
		key: string,
		val?: string,
	): { nodes: OsmNode[]; ways: OsmWay[]; relations: OsmRelation[] } {
		const nodes = osm.nodes.search(key, val)
		const ways = osm.ways.search(key, val)
		const relations = osm.relations.search(key, val)
		return { nodes, ways, relations }
	}
}

async function readGeoJSON(data: ArrayBufferLike | ReadableStream) {
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
	return geojson
}
