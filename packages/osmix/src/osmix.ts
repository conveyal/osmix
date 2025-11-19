import {
	generateChangeset,
	OsmChangeset,
	type OsmMergeOptions,
} from "@osmix/change"
import { Osm, type OsmOptions } from "@osmix/core"
import { startCreateOsmFromGeoJSON } from "@osmix/geojson"
import { OsmBlocksToJsonTransformStream } from "@osmix/json"
import { OsmPbfBytesToBlocksTransformStream, readOsmPbf } from "@osmix/pbf"
import { DEFAULT_RASTER_TILE_SIZE, OsmixRasterTile } from "@osmix/raster"
import { logProgress, type ProgressEvent } from "@osmix/shared/progress"
import type {
	GeoBbox2D,
	OsmNode,
	OsmRelation,
	OsmWay,
	Tile,
} from "@osmix/shared/types"
import { OsmixVtEncoder } from "@osmix/vt"
import { createExtract, type ExtractStrategy } from "./extract"
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

	/**
	 * Read only the header block from PBF data without parsing entities.
	 * Useful for previewing metadata before loading the entire dataset.
	 */
	static async readHeader(data: Parameters<typeof readOsmPbf>[0]) {
		const { header } = await readOsmPbf(data)
		return header
	}

	/**
	 * Create a new Osmix instance from PBF-encoded OSM data.
	 * Automatically handles both ArrayBufferLike and ReadableStream inputs.
	 * Options support bbox extraction, entity filtering, and selective spatial index building.
	 */
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

	/**
	 * Create a new Osmix instance from GeoJSON data.
	 * GeoJSON Features are converted into OSM nodes, ways, and relations.
	 * Supports both FeatureCollections with Point and LineString geometries.
	 */
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

	/**
	 * Transform OSM PBF data into a stream of JSON entities.
	 */
	static transformOsmPbfToJson(data: ArrayBufferLike | ReadableStream) {
		const dataStream =
			data instanceof ReadableStream
				? data
				: new ReadableStream({
						start: (controller) => {
							controller.enqueue(new Uint8Array(data))
							controller.close()
						},
					})
		return dataStream
			.pipeThrough(new OsmPbfBytesToBlocksTransformStream())
			.pipeThrough(new OsmBlocksToJsonTransformStream())
	}

	/**
	 * Serialize this Osmix instance to a streaming PBF format.
	 * Returns a ReadableStream of Uint8Array chunks for efficient memory usage.
	 * Entities are written sorted by type (nodes, ways, relations) and ID.
	 */
	toPbfStream(): ReadableStream<Uint8Array> {
		return osmToPbfStream(this)
	}

	/**
	 * Serialize this Osmix instance to a single PBF buffer in memory.
	 * For large datasets, prefer toPbfStream to avoid memory pressure.
	 */
	async toPbf(): Promise<Uint8Array> {
		return osmToPbfBuffer(this)
	}

	/**
	 * Generate a Mapbox Vector Tile (MVT) for the specified tile coordinates.
	 * Returns encoded MVT data suitable for MapLibre or Mapbox GL rendering.
	 */
	getVectorTile(tile: Tile) {
		return this.vtEncoder.getTile(tile)
	}

	/**
	 * Generate a raster tile as ImageData for the specified tile coordinates.
	 * Draws OSM geometries (ways as lines/polygons, multipolygon relations) onto a canvas.
	 * Returns the raw RGBA pixel data array.
	 */
	getRasterTile(tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		return drawRasterTile(this, new OsmixRasterTile({ tile, tileSize }))
			.imageData
	}

	/**
	 * Search all entity types (nodes, ways, relations) for matching tags.
	 * If val is omitted, matches any entity with the specified key.
	 * If val is provided, matches entities where key=val.
	 */
	search(
		key: string,
		val?: string,
	): { nodes: OsmNode[]; ways: OsmWay[]; relations: OsmRelation[] } {
		const nodes = this.nodes.search(key, val)
		const ways = this.ways.search(key, val)
		const relations = this.relations.search(key, val)
		return { nodes, ways, relations }
	}

	/**
	 * Create an OsmChangeset representing differences between this instance and another.
	 * If other is provided, generates create/modify/delete changes for merging.
	 * If other is omitted, returns an empty changeset for this instance.
	 */
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

	/**
	 * Create a new Osmix instance from a bounding box.
	 * The new instance will only contain the entities within the bounding box.
	 * The strategy determines how to handle ways/relations that cross the bbox.
	 * "simple" strategy clips ways/members to the bbox, "complete_ways" includes complete ways/relations.
	 */
	extract(
		bbox: GeoBbox2D,
		strategy: ExtractStrategy = "complete_ways",
		onProgress: (progress: ProgressEvent) => void = logProgress,
	) {
		const osm = createExtract(this, bbox, strategy, onProgress)
		return new Osmix(osm.transferables())
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
