import { VectorTile } from "@mapbox/vector-tile"
import { Osmix } from "@osmix/core"
import SphericalMercatorTile from "@osmix/shared/spherical-mercator"
import { decodeZigzag } from "@osmix/shared/zigzag"
import type { GeoBbox2D, Tile } from "@osmix/shared/types"
import Protobuf from "pbf"
import { describe, expect, it } from "vitest"
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
	tags: { highway: "primary" },
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
		expect(layers[NODE_LAYER_ID]).toBeDefined()
		expect(layers[NODE_LAYER_ID]?.length).toBe(1)
		expect(layers[WAY_LAYER_ID]).toBeDefined()
		expect(layers[WAY_LAYER_ID]?.length).toBe(1)

		const nodeLayer = layers[NODE_LAYER_ID]
		const wayLayer = layers[WAY_LAYER_ID]
		if (!nodeLayer || !wayLayer) throw new Error("Layers not found")
		const features = [nodeLayer.feature(0), wayLayer.feature(0)]

		const node = features.find(
			(feature) => feature.properties["type"] === "node",
		)
		// IDs are zigzag-encoded, so decode them
		if (node?.id !== undefined) {
			const decodedId = decodeZigzag(node.id)
			expect(decodedId).toBe(1)
		}
		expect(node?.type).toBe(1)
		const nodeGeom = node?.loadGeometry()
		expect(nodeGeom?.[0]?.[0]?.x).toBeTypeOf("number")
		expect(nodeGeom?.[0]?.[0]?.y).toBeTypeOf("number")

		const way = features.find((feature) => feature.properties["type"] === "way")
		// IDs are zigzag-encoded, so decode them
		if (way?.id !== undefined) {
			const decodedId = decodeZigzag(way.id)
			expect(decodedId).toBe(5)
		}
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
		expect(wayLayer?.length).toBe(1)

		const feature = wayLayer?.feature(0)
		if (!feature) throw new Error("Feature not found")
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
		const processedOuter = encoder["processClippedPolygonRing"](
			outerRing!,
			true,
		)
		expect(processedOuter.length).toBeGreaterThan(0)

		// Process as inner ring (should be counterclockwise)
		const processedInner = encoder["processClippedPolygonRing"](
			outerRing!,
			false,
		)
		expect(processedInner.length).toBeGreaterThan(0)

		// Verify they have opposite winding (area should have opposite signs)
		const outerArea = processedOuter.reduce((sum, p, i) => {
			const next = processedOuter[(i + 1) % processedOuter.length]
			if (!next) return sum
			return sum + (p[0] * next[1] - next[0] * p[1])
		}, 0)
		const innerArea = processedInner.reduce((sum, p, i) => {
			const next = processedInner[(i + 1) % processedInner.length]
			if (!next) return sum
			return sum + (p[0] * next[1] - next[0] * p[1])
		}, 0)

		// Outer should be clockwise (negative area), inner should be counterclockwise (positive area)
		expect(outerArea).toBeLessThan(0)
		expect(innerArea).toBeGreaterThan(0)
	})

	it("encodes multipolygon relation with correct winding order", () => {
		const testOsm = new Osmix()
		// Create nodes for outer square
		testOsm.nodes.addNode({ id: 1, lat: -1.0, lon: -1.0 })
		testOsm.nodes.addNode({ id: 2, lat: -1.0, lon: 1.0 })
		testOsm.nodes.addNode({ id: 3, lat: 1.0, lon: 1.0 })
		testOsm.nodes.addNode({ id: 4, lat: 1.0, lon: -1.0 })
		// Create nodes for inner triangle
		testOsm.nodes.addNode({ id: 5, lat: -0.5, lon: 0.0 })
		testOsm.nodes.addNode({ id: 6, lat: 0.5, lon: 0.0 })
		testOsm.nodes.addNode({ id: 7, lat: 0.0, lon: 0.5 })

		// Create outer way
		testOsm.ways.addWay({
			id: 10,
			refs: [1, 2, 3, 4, 1],
			tags: {},
		})
		// Create inner way
		testOsm.ways.addWay({
			id: 11,
			refs: [5, 6, 7, 5],
			tags: {},
		})

		// Create multipolygon relation
		testOsm.relations.addRelation({
			id: 20,
			tags: { type: "multipolygon", name: "test" },
			members: [
				{ type: "way", ref: 10, role: "outer" },
				{ type: "way", ref: 11, role: "inner" },
			],
		})

		testOsm.buildIndexes()
		testOsm.buildSpatialIndexes()

		const bbox: GeoBbox2D = [-2, -2, 2, 2]
		const tile = bboxToTile(bbox)
		const encoder = new OsmixVtEncoder(testOsm)

		const proj = (ll: [number, number]) => {
			const [px, py] = merc.px(ll, tile[2])
			return [px - tile[0] * extent, py - tile[1] * extent] as [number, number]
		}

		const features = Array.from(encoder.relationFeatures(bbox, proj))
		expect(features.length).toBeGreaterThan(0)

		const relationFeature = features[0]
		expect(relationFeature).toBeDefined()
		expect(relationFeature?.type).toBe(3) // POLYGON
		expect(relationFeature?.properties.type).toBe("relation")

		const geometry = relationFeature?.geometry
		expect(geometry).toBeDefined()
		expect(Array.isArray(geometry)).toBe(true)
		if (geometry && Array.isArray(geometry) && geometry.length > 0) {
			const outerRing = geometry[0]
			expect(outerRing).toBeDefined()
			if (outerRing && Array.isArray(outerRing) && outerRing.length > 0) {
				// Verify outer ring is clockwise (negative signed area)
				const outerArea = outerRing.reduce((sum, p, i) => {
					const next = outerRing[(i + 1) % outerRing.length]
					if (!next) return sum
					return sum + (p[0] * next[1] - next[0] * p[1])
				}, 0)
				expect(outerArea).toBeLessThan(0) // Clockwise

				// If there's an inner ring, verify it's counterclockwise
				if (geometry.length > 1) {
					const innerRing = geometry[1]
					if (innerRing && Array.isArray(innerRing) && innerRing.length > 0) {
						const innerArea = innerRing.reduce((sum, p, i) => {
							const next = innerRing[(i + 1) % innerRing.length]
							if (!next) return sum
							return sum + (p[0] * next[1] - next[0] * p[1])
						}, 0)
						expect(innerArea).toBeGreaterThan(0) // Counterclockwise
					}
				}
			}
		}
	})

	it("encodes area way as polygon with correct winding order", () => {
		const testOsm = new Osmix()
		// Create a square polygon
		testOsm.nodes.addNode({ id: 1, lat: 40.7, lon: -74.0 })
		testOsm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.0 })
		testOsm.nodes.addNode({ id: 3, lat: 40.71, lon: -74.01 })
		testOsm.nodes.addNode({ id: 4, lat: 40.7, lon: -74.01 })
		testOsm.ways.addWay({
			id: 10,
			refs: [1, 2, 3, 4, 1],
			tags: { area: "yes", building: "yes" },
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

		const features = Array.from(encoder.wayFeatures(bbox, proj))
		const polygonFeature = features.find((f) => f.type === 3) // POLYGON
		expect(polygonFeature).toBeDefined()

		if (polygonFeature?.geometry) {
			const geometry = polygonFeature.geometry
			if (Array.isArray(geometry) && geometry.length > 0) {
				const ring = geometry[0]
				if (ring && Array.isArray(ring) && ring.length > 0) {
					// Verify clockwise winding (negative area)
					const area = ring.reduce((sum, p, i) => {
						const next = ring[(i + 1) % ring.length]
						if (!next) return sum
						return sum + (p[0] * next[1] - next[0] * p[1])
					}, 0)
					expect(area).toBeLessThan(0) // Should be clockwise for MVT
				}
			}
		}
	})

	it("encodes negative IDs correctly", () => {
		const testOsm = new Osmix()
		// Create nodes with negative IDs (like from GeoJSON import)
		testOsm.nodes.addNode({
			id: -1,
			lat: 40.7,
			lon: -74.0,
			tags: { name: "Negative Node" },
		})
		testOsm.nodes.addNode({
			id: -2,
			lat: 40.71,
			lon: -74.01,
			tags: { name: "Another Negative Node" },
		})
		testOsm.ways.addWay({
			id: -10,
			refs: [-1, -2],
			tags: { highway: "primary" },
		})
		testOsm.buildIndexes()
		testOsm.buildSpatialIndexes()

		const bbox = testOsm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new OsmixVtEncoder(testOsm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		const nodeLayer = layers[NODE_LAYER_ID]
		const wayLayer = layers[WAY_LAYER_ID]

		expect(nodeLayer).toBeDefined()
		expect(wayLayer).toBeDefined()

		// Check that negative IDs are zigzag-encoded and can be decoded back
		if (nodeLayer && nodeLayer.length > 0) {
			const nodeFeature = nodeLayer.feature(0)
			// IDs are zigzag-encoded, so decode them
			if (nodeFeature.id !== undefined) {
				const decodedId = decodeZigzag(nodeFeature.id)
				expect(decodedId).toBe(-1)
			}
		}

		if (wayLayer && wayLayer.length > 0) {
			const wayFeature = wayLayer.feature(0)
			// IDs are zigzag-encoded, so decode them
			if (wayFeature.id !== undefined) {
				const decodedId = decodeZigzag(wayFeature.id)
				expect(decodedId).toBe(-10)
			}
		}
	})

	it("accepts IDs at the boundaries of safe integer range", () => {
		const testOsm = new Osmix()
		// Add nodes for ways to reference
		testOsm.nodes.addNode({ id: 1, lat: 40.7, lon: -74.0 })
		testOsm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.01 })
		// Test minimum valid ID (way)
		testOsm.ways.addWay({
			id: -Number.MAX_SAFE_INTEGER,
			refs: [1, 2],
			tags: { highway: "primary" },
		})
		// Test maximum valid ID (node with tags)
		testOsm.nodes.addNode({
			id: Number.MAX_SAFE_INTEGER,
			lat: 40.72,
			lon: -74.02,
			tags: { name: "Max ID" },
		})
		testOsm.buildIndexes()
		testOsm.buildSpatialIndexes()

		const bbox = testOsm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new OsmixVtEncoder(testOsm)

		// Should not throw - this verifies the IDs are within the valid range
		const result = encoder.getTile(tile)
		expect(result.byteLength).toBeGreaterThan(0)
	})

	it("encodes and decodes large negative IDs correctly", () => {
		const testOsm = new Osmix()
		// Test with a large negative ID (much larger than 32-bit range)
		const largeNegativeId = -1000000000 // -1 billion
		// Add a node for the way to reference
		testOsm.nodes.addNode({ id: 1, lat: 40.71, lon: -74.01 })
		testOsm.nodes.addNode({
			id: largeNegativeId,
			lat: 40.7,
			lon: -74.0,
			tags: { name: "Large Negative ID" },
		})
		// Add a dummy way so way spatial index can be built
		testOsm.ways.addWay({
			id: 100,
			refs: [1],
			tags: {},
		})
		testOsm.buildIndexes()
		testOsm.buildSpatialIndexes()

		const bbox = testOsm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new OsmixVtEncoder(testOsm)
		const result = encoder.getTile(tile)

		const layers = decodeTile(result)
		const nodeLayer = layers[NODE_LAYER_ID]

		expect(nodeLayer).toBeDefined()
		if (nodeLayer && nodeLayer.length > 0) {
			// Find the node with the large negative ID
			let found = false
			for (let i = 0; i < nodeLayer.length; i++) {
				const nodeFeature = nodeLayer.feature(i)
				if (nodeFeature.id !== undefined) {
					const decodedId = decodeZigzag(nodeFeature.id)
					if (decodedId === largeNegativeId) {
						found = true
						break
					}
				}
			}
			expect(found).toBe(true)
		}
	})
})
