import { SphericalMercator } from "@mapbox/sphericalmercator"
import type { OsmEntityType, OsmTags } from "@osmix/json"
import { clipPolyline } from "@osmix/shared/lineclip"
import { fromVectorTileJs as encodeVectorTile } from "vt-pbf"
import type {
	BinaryTilePayload,
	EncodeTileOptions,
	EncodeTileResult,
} from "./types"

type Vec2 = {
	x: number
	y: number
}

type Geometry = Vec2[][]

const DEFAULT_EXTENT = 4096
const DEFAULT_BUFFER = 64

type SimpleFeatureProperties = {
	datasetId: string
	type: OsmEntityType
	tags?: OsmTags
	tileKey?: string
}

class SimpleFeature {
	id: number
	type: 1 | 2 | 3
	properties: SimpleFeatureProperties
	private geometry: Geometry

	constructor(
		id: number,
		type: 1 | 2 | 3,
		properties: SimpleFeatureProperties,
		geometry: Geometry,
	) {
		this.id = id
		this.type = type
		this.properties = properties
		this.geometry = geometry
	}

	loadGeometry() {
		return this.geometry
	}
}

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max)

const dedupePoints = (points: [x: number, y: number][]) => {
	if (points.length < 2) return points
	const result: [x: number, y: number][] = []
	let lastPoint: [x: number, y: number] = [Number.NaN, Number.NaN]
	for (const point of points) {
		if (point[0] === lastPoint[0] && point[1] === lastPoint[1]) continue
		result.push(point)
		lastPoint = point
	}
	return result
}

const clampAndRoundPoint = (
	x: number,
	y: number,
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
): [x: number, y: number] => {
	const clampedX = Math.round(clamp(x, minX, maxX))
	const clampedY = Math.round(clamp(y, minY, maxY))
	return [clampedX, clampedY]
}

/**
 * Convert the features into the type of input expected by the vector tile encoder.
 * See {@link https://github.com/mapbox/vt-pbf/blob/main/index.js}
 */
function createVtPbfTileLayer(
	layerName: string,
	extent: number,
	features: SimpleFeature[],
) {
	return {
		name: layerName,
		version: 2,
		extent,
		length: features.length,
		feature: (index: number) => features[index],
	}
}

export function encodeBinaryTile(
	payload: BinaryTilePayload,
	options: EncodeTileOptions,
): EncodeTileResult {
	const extent = options.extent ?? DEFAULT_EXTENT
	const buffer = options.buffer ?? DEFAULT_BUFFER
	const tile = options.tileIndex
	const tileKey =
		options.tileKey ?? `${options.datasetId}:${tile.z}:${tile.x}:${tile.y}`
	const layerName = options.layerPrefix ?? "osmix"

	const minCoord = -buffer
	const maxCoord = extent + buffer
	// TODO use bbox instead? This does not seem right...
	const minX = minCoord
	const maxX = maxCoord
	const minY = minCoord
	const maxY = maxCoord
	const projector = new SphericalMercator({ size: extent })

	const projectLonLat = (lon: number, lat: number): [x: number, y: number] => {
		const [px, py] = projector.px([lon, lat], tile.z)
		return [px - extent * tile.x, py - extent * tile.y]
	}

	const nodeFeatures: SimpleFeature[] = []
	const nodeLayerName = `${layerName}:nodes`
	const wayFeatures: SimpleFeature[] = []
	const wayLayerName = `${layerName}:ways`

	if (payload.nodes) {
		const { ids, positions } = payload.nodes
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i]
			const lon = positions[i * 2]
			const lat = positions[i * 2 + 1]

			const [x, y] = projectLonLat(lon, lat)

			const [clampedX, clampedY] = clampAndRoundPoint(
				x,
				y,
				minCoord,
				maxCoord,
				minCoord,
				maxCoord,
			)

			const geometry: Geometry = [
				[
					{
						x: clampedX,
						y: clampedY,
					},
				],
			]
			const properties: SimpleFeatureProperties = {
				datasetId: options.datasetId,
				type: "node",
			}

			if (options.includeTileKey) {
				properties.tileKey = tileKey
			}

			nodeFeatures.push(new SimpleFeature(id, 1, properties, geometry))
		}
	}

	if (payload.ways) {
		const { ids, positions, startIndices } = payload.ways

		for (let i = 0; i < ids.length; i++) {
			const id = ids[i]
			const start = startIndices[i]
			const end = startIndices[i + 1]
			if (end - start < 2) continue

			const projectedPoints: [x: number, y: number][] = []
			for (let p = start; p < end; p++) {
				const lon = positions[p * 2]
				const lat = positions[p * 2 + 1]
				projectedPoints.push(projectLonLat(lon, lat))
			}

			const clippedSegmentsRaw = clipPolyline(projectedPoints, [
				minX,
				minY,
				maxX,
				maxY,
			])

			const tileSegments: Geometry = []

			for (const segment of clippedSegmentsRaw) {
				const rounded = segment.map(([x, y]) =>
					clampAndRoundPoint(x, y, minX, maxX, minY, maxY),
				)
				const deduped = dedupePoints(rounded)
				if (deduped.length >= 2) {
					tileSegments.push(deduped.map(([x, y]) => ({ x, y })))
				}
			}
			if (tileSegments.length === 0) continue

			const properties: SimpleFeatureProperties = {
				datasetId: options.datasetId,
				type: "way",
			}
			if (options.includeTileKey) {
				properties.tileKey = tileKey
			}

			wayFeatures.push(new SimpleFeature(id, 2, properties, tileSegments))
		}
	}

	const bufferData = encodeVectorTile({
		layers: {
			[wayLayerName]: createVtPbfTileLayer(wayLayerName, extent, wayFeatures),
			[nodeLayerName]: createVtPbfTileLayer(
				nodeLayerName,
				extent,
				nodeFeatures,
			),
		},
	} as unknown as Parameters<typeof encodeVectorTile>[0])
	return {
		data: bufferData.buffer as ArrayBuffer,
		tileKey,
		extent,
	}
}
