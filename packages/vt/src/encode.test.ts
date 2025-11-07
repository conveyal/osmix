import { VectorTile } from "@mapbox/vector-tile"
import { Osmix } from "@osmix/core"
import SphericalMercatorTile from "@osmix/shared/spherical-mercator"
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
const merc = new SphericalMercatorTile({ size: extent })

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

	it("encodes area ways as polygons with proper winding order", () => {
		const testOsm = new Osmix()
		// Create a closed way that should be treated as an area
		testOsm.nodes.addNode({ id: 10, lat: 40.7, lon: -74.0 })
		testOsm.nodes.addNode({ id: 11, lat: 40.71, lon: -74.0 })
		testOsm.nodes.addNode({ id: 12, lat: 40.71, lon: -74.01 })
		testOsm.nodes.addNode({ id: 13, lat: 40.7, lon: -74.01 })
		testOsm.ways.addWay({
			id: 20,
			refs: [10, 11, 12, 13, 10], // Closed ring
			tags: { building: "yes", area: "yes" },
		})
		testOsm.buildIndexes()
		testOsm.buildSpatialIndexes()

		const bbox = testOsm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new OsmixVtEncoder(testOsm)
		const result = encoder.getTile(tile)

		const layers = decodeTile(result)
		const wayLayer = layers[`@osmix:${testOsm.id}:ways`]
		expect(wayLayer.length).toBe(1)

		const feature = wayLayer.feature(0)
		expect(feature.type).toBe(3) // POLYGON type
		expect(feature.properties["type"]).toBe("way")
		expect(feature.properties["building"]).toBe("yes")

		const geometry = feature.loadGeometry()
		expect(geometry.length).toBeGreaterThan(0)
		// Should have at least one ring (outer ring)
		expect(geometry[0]?.length).toBeGreaterThanOrEqual(4) // At least 4 points for a polygon
	})

	it("handles multiple rings for polygons (infrastructure for holes)", () => {
		const testOsm = new Osmix()
		// Create an area way
		testOsm.nodes.addNode({ id: 20, lat: 40.7, lon: -74.0 })
		testOsm.nodes.addNode({ id: 21, lat: 40.71, lon: -74.0 })
		testOsm.nodes.addNode({ id: 22, lat: 40.71, lon: -74.01 })
		testOsm.nodes.addNode({ id: 23, lat: 40.7, lon: -74.01 })
		testOsm.ways.addWay({
			id: 30,
			refs: [20, 21, 22, 23, 20],
			tags: { building: "yes", area: "yes" },
		})
		testOsm.buildIndexes()
		testOsm.buildSpatialIndexes()

		const bbox = testOsm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new OsmixVtEncoder(testOsm)

		// Test that clipProjectedPolygon returns array of rings
		const proj = (ll: [number, number]) => {
			const [px, py] = merc.px(ll, tile[2])
			return [px - tile[0] * extent, py - tile[1] * extent] as [number, number]
		}

		const way = testOsm.ways.getById(30)
		expect(way).toBeDefined()
		const points = way!.refs.map((ref) => {
			const node = testOsm.nodes.getById(ref)
			return proj([node!.lon, node!.lat])
		})

		const clippedRings = encoder["clipProjectedPolygon"](points)
		expect(Array.isArray(clippedRings)).toBe(true)
		expect(clippedRings.length).toBeGreaterThan(0)
		expect(Array.isArray(clippedRings[0])).toBe(true)
	})

	it("processes polygon rings with correct winding order (outer clockwise, inner counterclockwise)", () => {
		const testOsm = new Osmix()
		testOsm.nodes.addNode({ id: 30, lat: 40.7, lon: -74.0 })
		testOsm.nodes.addNode({ id: 31, lat: 40.71, lon: -74.0 })
		testOsm.nodes.addNode({ id: 32, lat: 40.71, lon: -74.01 })
		testOsm.nodes.addNode({ id: 33, lat: 40.7, lon: -74.01 })
		testOsm.ways.addWay({
			id: 40,
			refs: [30, 31, 32, 33, 30],
			tags: { building: "yes", area: "yes" },
		})
		testOsm.buildIndexes()
		testOsm.buildSpatialIndexes()

		const bbox = testOsm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new OsmixVtEncoder(testOsm)

		const proj = (ll: [number, number]) => {
			const [px, py] = merc.px(ll, tile[2])
			return [px - tile[0] * extent, py - tile[1] * extent] as [number, number]
		}

		const way = testOsm.ways.getById(40)
		const points = way!.refs.map((ref) => {
			const node = testOsm.nodes.getById(ref)
			return proj([node!.lon, node!.lat])
		})

		const clippedRings = encoder["clipProjectedPolygon"](points)
		const outerRing = clippedRings[0]
		expect(outerRing).toBeDefined()

		// Process as outer ring (should be clockwise)
		const processedOuter = encoder["processClippedPolygonRing"](outerRing!, true)
		expect(processedOuter.length).toBeGreaterThan(0)

		// Process as inner ring (should be counterclockwise)
		const processedInner = encoder["processClippedPolygonRing"](outerRing!, false)
		expect(processedInner.length).toBeGreaterThan(0)

		// Verify they have opposite winding (area should have opposite signs)
		const outerArea = processedOuter.reduce((sum, p, i) => {
			const next = processedOuter[(i + 1) % processedOuter.length]
			return sum + (p[0] * next[1] - next[0] * p[1])
		}, 0)
		const innerArea = processedInner.reduce((sum, p, i) => {
			const next = processedInner[(i + 1) % processedInner.length]
			return sum + (p[0] * next[1] - next[0] * p[1])
		}, 0)

		// Outer should be clockwise (negative area), inner should be counterclockwise (positive area)
		expect(outerArea).toBeLessThan(0)
		expect(innerArea).toBeGreaterThan(0)
	})
})
