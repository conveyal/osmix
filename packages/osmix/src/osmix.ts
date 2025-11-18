import {
	generateChangeset,
	OsmChangeset,
	type OsmMergeOptions,
} from "@osmix/change"
import { Osm, type OsmOptions } from "@osmix/core"
import { startCreateOsmFromGeoJSON } from "@osmix/geojson"
import { readOsmPbf } from "@osmix/pbf"
import { DEFAULT_RASTER_TILE_SIZE, OsmixRasterTile } from "@osmix/raster"
import { logProgress, type ProgressEvent } from "@osmix/shared/progress"
import type { OsmNode, OsmRelation, OsmWay, Tile } from "@osmix/shared/types"
import { OsmixVtEncoder } from "@osmix/vt"
import {
	createOsmFromPbf,
	type OsmFromPbfOptions,
	osmToPbfBuffer,
	osmToPbfStream,
} from "./pbf"
import { drawRasterTile } from "./raster"

/**
 * Extends the base Osm indexes and adds additional helper methods for working with Osm data.
 */
export class Osmix extends Osm {
	private vtEncoder = new OsmixVtEncoder(this)

	static async readHeader(data: Parameters<typeof readOsmPbf>[0]) {
		const { header } = await readOsmPbf(data)
		return header
	}

	static async fromPbf(
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmFromPbfOptions> = {},
		onProgress: (progress: ProgressEvent) => void = logProgress,
	): Promise<Osmix> {
		const osm = await createOsmFromPbf(
			data instanceof ReadableStream ? data : new Uint8Array(data),
			options,
			onProgress,
		)
		return new Osmix(osm.transferables())
	}

	static async fromGeoJSON(
		data: ArrayBufferLike | ReadableStream,
		options: Partial<OsmOptions> = {},
		onProgress: (progress: ProgressEvent) => void = logProgress,
	) {
		const geojson = await readGeoJSON(data)
		const osm = new Osmix(options)
		for (const update of startCreateOsmFromGeoJSON(osm, geojson)) {
			onProgress(update)
		}
		return osm
	}

	toPbfStream(): ReadableStream<Uint8Array> {
		return osmToPbfStream(this)
	}

	async toPbf(): Promise<Uint8Array> {
		return osmToPbfBuffer(this)
	}

	getVectorTile(tile: Tile) {
		return this.vtEncoder.getTile(tile)
	}

	getRasterTile(tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		return drawRasterTile(this, new OsmixRasterTile({ tile, tileSize }))
			.imageData
	}

	search(
		key: string,
		val?: string,
	): { nodes: OsmNode[]; ways: OsmWay[]; relations: OsmRelation[] } {
		const nodes = this.nodes.search(key, val)
		const ways = this.ways.search(key, val)
		const relations = this.relations.search(key, val)
		return { nodes, ways, relations }
	}

	createChangeset(
		other?: Osm,
		options: Partial<OsmMergeOptions> = {},
		onProgress: (progress: ProgressEvent) => void = logProgress,
	) {
		if (other) {
			return generateChangeset(this, other, options, onProgress)
		}
		return new OsmChangeset(this)
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
