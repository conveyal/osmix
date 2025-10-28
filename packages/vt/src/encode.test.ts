import { SphericalMercator } from "@mapbox/sphericalmercator"
import { VectorTile } from "@mapbox/vector-tile"
import { Osmix } from "@osmix/core"
import type { GeoBbox2D, Tile } from "@osmix/shared/types"
import Protobuf from "pbf"
import { assert, describe, expect, it } from "vitest"
import { OsmixVtEncoder } from "./encode"

const osm = new Osmix()
osm.nodes.addNode({
	id: 1,
	lat: 40,
	lon: -74,
	tags: {
		name: "Test Node",
	},
})

// Add nodes for way
osm.nodes.addNode({
	id: 2,
	lat: 40.72,
	lon: -74.01,
})

osm.nodes.addNode({
	id: 3,
	lat: 40.715,
	lon: -74.005,
})

osm.nodes.addNode({
	id: 4,
	lat: 40.7122,
	lon: -74.001,
})

osm.ways.addWay({
	id: 5,
	refs: [1, 2],
})
osm.buildIndexes()
osm.buildSpatialIndexes()

const WAY_LAYER_ID = `@osmix:${osm.id}:ways`
const NODE_LAYER_ID = `@osmix:${osm.id}:nodes`

function decodeTile(data: ArrayBuffer) {
	const tile = new VectorTile(new Protobuf(data))
	return tile.layers
}

const extent = 4096
const merc = new SphericalMercator({ size: extent })
function pointToTile(lon: number, lat: number, z: number): Tile {
	const [px, py] = merc.px([lon, lat], z)
	const x = Math.floor(px / extent)
	const y = Math.floor(py / extent)
	return [x, y, z]
}
function bboxToTile(bbox: GeoBbox2D, z = 8): Tile {
	const [minX, minY, maxX, maxY] = bbox
	const centerLon = (minX + maxX) / 2
	const centerLat = (minY + maxY) / 2
	return pointToTile(centerLon, centerLat, z)
}

describe("OsmixVtEncoder", () => {
	it("encodes nodes and ways with expected metadata", () => {
		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new OsmixVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		assert.isDefined(layers[NODE_LAYER_ID])
		expect(layers[NODE_LAYER_ID].length).toBe(1)
		assert.isDefined(layers[WAY_LAYER_ID])
		expect(layers[WAY_LAYER_ID].length).toBe(1)

		const features = [
			layers[NODE_LAYER_ID].feature(0),
			layers[WAY_LAYER_ID].feature(0),
		]

		const node = features.find(
			(feature) => feature.properties["type"] === "node",
		)
		expect(node?.id).toBe(1)
		expect(node?.type).toBe(1)
		const nodeGeom = node?.loadGeometry()
		expect(nodeGeom?.[0]?.[0]?.x).toBeTypeOf("number")
		expect(nodeGeom?.[0]?.[0]?.y).toBeTypeOf("number")

		const way = features.find((feature) => feature.properties["type"] === "way")
		expect(way?.id).toBe(5)
		expect(way?.type).toBe(2)
		const wayGeom = way?.loadGeometry()
		expect(wayGeom?.[0]?.length).toBeGreaterThanOrEqual(2)
	})
})
