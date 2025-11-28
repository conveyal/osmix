import { describe, expect, it } from "bun:test"
import { pointToTile } from "@mapbox/tilebelt"
import { VectorTile } from "@mapbox/vector-tile"
import { Osm } from "@osmix/core"
import type { GeoBbox2D, Tile } from "@osmix/shared/types"
import Protobuf from "pbf"
import { ShortbreadVtEncoder } from "./encoder"

function decodeTile(data: ArrayBuffer) {
	const tile = new VectorTile(new Protobuf(data))
	return tile.layers
}

function bboxToTile(bbox: GeoBbox2D, z = 8): Tile {
	const [minX, minY, maxX, maxY] = bbox
	const centerLon = (minX + maxX) / 2
	const centerLat = (minY + maxY) / 2
	return pointToTile(centerLon, centerLat, z)
}

describe("ShortbreadVtEncoder", () => {
	it("encodes a restaurant POI to the pois layer", () => {
		const osm = new Osm()
		osm.nodes.addNode({
			id: 1,
			lat: 40.7,
			lon: -74.0,
			tags: {
				amenity: "restaurant",
				name: "Test Restaurant",
			},
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["pois"]).toBeDefined()
		expect(layers["pois"]?.length).toBe(1)

		const feature = layers["pois"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("restaurant")
		expect(feature?.properties["name"]).toBe("Test Restaurant")
		expect(feature?.type).toBe(1) // Point
	})

	it("encodes a primary road to the streets layer", () => {
		const osm = new Osm()
		osm.nodes.addNode({ id: 1, lat: 40.7, lon: -74.0 })
		osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.01 })
		osm.ways.addWay({
			id: 10,
			refs: [1, 2],
			tags: {
				highway: "primary",
				name: "Main Street",
				oneway: "yes",
			},
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["streets"]).toBeDefined()
		expect(layers["streets"]?.length).toBe(1)

		const feature = layers["streets"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("primary")
		expect(feature?.properties["name"]).toBe("Main Street")
		expect(feature?.properties["oneway"]).toBe(1) // Booleans encoded as 0/1
		expect(feature?.type).toBe(2) // LineString
	})

	it("encodes a building to the buildings layer", () => {
		const osm = new Osm()
		osm.nodes.addNode({ id: 1, lat: 40.7, lon: -74.0 })
		osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.0 })
		osm.nodes.addNode({ id: 3, lat: 40.71, lon: -74.01 })
		osm.nodes.addNode({ id: 4, lat: 40.7, lon: -74.01 })
		osm.ways.addWay({
			id: 10,
			refs: [1, 2, 3, 4, 1],
			tags: {
				building: "yes",
				height: "20",
				"building:levels": "5",
			},
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["buildings"]).toBeDefined()
		expect(layers["buildings"]?.length).toBe(1)

		const feature = layers["buildings"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("building")
		expect(feature?.properties["height"]).toBe(20)
		expect(feature?.properties["levels"]).toBe(5)
		expect(feature?.type).toBe(3) // Polygon
	})

	it("encodes water bodies to the water layer", () => {
		const osm = new Osm()
		osm.nodes.addNode({ id: 1, lat: 40.7, lon: -74.0 })
		osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.0 })
		osm.nodes.addNode({ id: 3, lat: 40.71, lon: -74.01 })
		osm.nodes.addNode({ id: 4, lat: 40.7, lon: -74.01 })
		osm.ways.addWay({
			id: 10,
			refs: [1, 2, 3, 4, 1],
			tags: {
				natural: "water",
				water: "lake",
				name: "Test Lake",
			},
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["water"]).toBeDefined()
		expect(layers["water"]?.length).toBe(1)

		const feature = layers["water"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("lake")
		expect(feature?.properties["name"]).toBe("Test Lake")
		expect(feature?.type).toBe(3) // Polygon
	})

	it("encodes water lines to the water_lines layer", () => {
		const osm = new Osm()
		osm.nodes.addNode({ id: 1, lat: 40.7, lon: -74.0 })
		osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.01 })
		osm.ways.addWay({
			id: 10,
			refs: [1, 2],
			tags: {
				waterway: "river",
				name: "Test River",
			},
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["water_lines"]).toBeDefined()
		expect(layers["water_lines"]?.length).toBe(1)

		const feature = layers["water_lines"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("river")
		expect(feature?.properties["name"]).toBe("Test River")
		expect(feature?.type).toBe(2) // LineString
	})

	it("encodes places to the places layer", () => {
		const osm = new Osm()
		osm.nodes.addNode({
			id: 1,
			lat: 40.7,
			lon: -74.0,
			tags: {
				place: "city",
				name: "Test City",
				population: "1000000",
				capital: "yes",
			},
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["places"]).toBeDefined()
		expect(layers["places"]?.length).toBe(1)

		const feature = layers["places"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("city")
		expect(feature?.properties["name"]).toBe("Test City")
		expect(feature?.properties["population"]).toBe(1000000)
		expect(feature?.properties["capital"]).toBe(1) // Booleans encoded as 0/1
	})

	it("encodes land areas to the land layer", () => {
		const osm = new Osm()
		osm.nodes.addNode({ id: 1, lat: 40.7, lon: -74.0 })
		osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.0 })
		osm.nodes.addNode({ id: 3, lat: 40.71, lon: -74.01 })
		osm.nodes.addNode({ id: 4, lat: 40.7, lon: -74.01 })
		osm.ways.addWay({
			id: 10,
			refs: [1, 2, 3, 4, 1],
			tags: {
				landuse: "residential",
				name: "Test Neighborhood",
			},
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["land"]).toBeDefined()
		expect(layers["land"]?.length).toBe(1)

		const feature = layers["land"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("residential")
	})

	it("encodes sites to the sites layer", () => {
		const osm = new Osm()
		osm.nodes.addNode({ id: 1, lat: 40.7, lon: -74.0 })
		osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.0 })
		osm.nodes.addNode({ id: 3, lat: 40.71, lon: -74.01 })
		osm.nodes.addNode({ id: 4, lat: 40.7, lon: -74.01 })
		osm.ways.addWay({
			id: 10,
			refs: [1, 2, 3, 4, 1],
			tags: {
				leisure: "park",
				name: "Test Park",
			},
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["sites"]).toBeDefined()
		expect(layers["sites"]?.length).toBe(1)

		const feature = layers["sites"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("park")
		expect(feature?.properties["name"]).toBe("Test Park")
	})

	it("encodes addresses to the addresses layer", () => {
		const osm = new Osm()
		osm.nodes.addNode({
			id: 1,
			lat: 40.7,
			lon: -74.0,
			tags: {
				"addr:housenumber": "42",
				"addr:street": "Main Street",
				"addr:city": "Test City",
			},
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["addresses"]).toBeDefined()
		expect(layers["addresses"]?.length).toBe(1)

		const feature = layers["addresses"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("address")
		expect(feature?.properties["housenumber"]).toBe("42")
		expect(feature?.properties["street"]).toBe("Main Street")
		expect(feature?.properties["city"]).toBe("Test City")
	})

	it("returns empty buffer when bbox does not intersect", () => {
		const osm = new Osm()
		osm.nodes.addNode({
			id: 1,
			lat: 40.7,
			lon: -74.0,
			tags: { amenity: "restaurant" },
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const encoder = new ShortbreadVtEncoder(osm)
		// Far away tile
		const result = encoder.getTile([8, 200, 100])

		expect(result.byteLength).toBe(0)
	})

	it("filters out features without matching tags", () => {
		const osm = new Osm()
		osm.nodes.addNode({
			id: 1,
			lat: 40.7,
			lon: -74.0,
			tags: { unknown: "tag" },
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		// Should return empty or very small buffer
		const layers = decodeTile(result)
		expect(Object.keys(layers).length).toBe(0)
	})

	it("encodes multipolygon relations to correct layer", () => {
		const osm = new Osm()
		// Create nodes for outer square
		osm.nodes.addNode({ id: 1, lat: 40.7, lon: -74.0 })
		osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.0 })
		osm.nodes.addNode({ id: 3, lat: 40.71, lon: -74.01 })
		osm.nodes.addNode({ id: 4, lat: 40.7, lon: -74.01 })

		osm.ways.addWay({
			id: 10,
			refs: [1, 2, 3, 4, 1],
			tags: {},
		})

		osm.relations.addRelation({
			id: 20,
			tags: {
				type: "multipolygon",
				natural: "water",
				water: "lake",
				name: "Relation Lake",
			},
			members: [{ type: "way", ref: 10, role: "outer" }],
		})

		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["water"]).toBeDefined()
		expect(layers["water"]?.length).toBe(1)

		const feature = layers["water"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("lake")
		expect(feature?.properties["name"]).toBe("Relation Lake")
	})

	it("provides static layerNames", () => {
		const names = ShortbreadVtEncoder.layerNames
		expect(names).toContain("water")
		expect(names).toContain("streets")
		expect(names).toContain("buildings")
		expect(names).toContain("pois")
		expect(names).toContain("places")
		expect(names).toContain("land")
		expect(names).toContain("sites")
	})

	it("encodes aerialways correctly", () => {
		const osm = new Osm()
		osm.nodes.addNode({ id: 1, lat: 46.5, lon: 7.9 })
		osm.nodes.addNode({ id: 2, lat: 46.51, lon: 7.91 })
		osm.ways.addWay({
			id: 10,
			refs: [1, 2],
			tags: {
				aerialway: "gondola",
				name: "Test Gondola",
			},
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["aerialways"]).toBeDefined()
		expect(layers["aerialways"]?.length).toBe(1)

		const feature = layers["aerialways"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("gondola")
	})

	it("encodes ferries correctly", () => {
		const osm = new Osm()
		osm.nodes.addNode({ id: 1, lat: 40.7, lon: -74.0 })
		osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.01 })
		osm.ways.addWay({
			id: 10,
			refs: [1, 2],
			tags: {
				route: "ferry",
				name: "Test Ferry",
			},
		})
		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)
		expect(layers["ferries"]).toBeDefined()
		expect(layers["ferries"]?.length).toBe(1)

		const feature = layers["ferries"]?.feature(0)
		expect(feature?.properties["kind"]).toBe("ferry")
	})

	it("sets correct entity type for nodes, ways, and relations", () => {
		const osm = new Osm()

		// Add a node (POI)
		osm.nodes.addNode({
			id: 1,
			lat: 40.7,
			lon: -74.0,
			tags: { amenity: "restaurant", name: "Node Restaurant" },
		})

		// Add nodes for way
		osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.0 })
		osm.nodes.addNode({ id: 3, lat: 40.71, lon: -74.01 })
		osm.nodes.addNode({ id: 4, lat: 40.7, lon: -74.01 })

		// Add a way (building)
		osm.ways.addWay({
			id: 10,
			refs: [2, 3, 4, 2],
			tags: { building: "yes", name: "Way Building" },
		})

		// Add nodes for relation
		osm.nodes.addNode({ id: 5, lat: 40.72, lon: -74.0 })
		osm.nodes.addNode({ id: 6, lat: 40.72, lon: -74.01 })
		osm.nodes.addNode({ id: 7, lat: 40.73, lon: -74.01 })
		osm.nodes.addNode({ id: 8, lat: 40.73, lon: -74.0 })

		// Add a way for the relation
		osm.ways.addWay({
			id: 20,
			refs: [5, 6, 7, 8, 5],
			tags: {},
		})

		// Add a relation (multipolygon water)
		osm.relations.addRelation({
			id: 100,
			tags: {
				type: "multipolygon",
				natural: "water",
				water: "lake",
				name: "Relation Lake",
			},
			members: [{ type: "way", ref: 20, role: "outer" }],
		})

		osm.buildIndexes()
		osm.buildSpatialIndexes()

		const bbox = osm.bbox()
		const tile = bboxToTile(bbox)
		const encoder = new ShortbreadVtEncoder(osm)
		const result = encoder.getTile(tile)

		expect(result.byteLength).toBeGreaterThan(0)

		const layers = decodeTile(result)

		// Check node entity type
		const poiFeature = layers["pois"]?.feature(0)
		expect(poiFeature?.properties["name"]).toBe("Node Restaurant")

		// Check way entity type
		const buildingFeature = layers["buildings"]?.feature(0)
		expect(buildingFeature?.properties["name"]).toBe("Way Building")

		// Check relation entity type
		const waterFeature = layers["water"]?.feature(0)
		expect(waterFeature?.properties["name"]).toBe("Relation Lake")
	})
})
