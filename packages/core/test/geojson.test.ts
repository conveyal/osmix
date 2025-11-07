import type {
	FeatureCollection,
	LineString,
	MultiPolygon,
	Point,
	Polygon,
} from "geojson"
import { describe, expect, it } from "vitest"
import { fromGeoJSON } from "../src/geojson"

describe("fromGeoJSON", () => {
	it("should convert Point features to Nodes", () => {
		const geojson: FeatureCollection<Point> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Point",
						coordinates: [-122.4194, 37.7749],
					},
					properties: {
						name: "San Francisco",
						population: 873965,
					},
				},
				{
					type: "Feature",
					geometry: {
						type: "Point",
						coordinates: [-122.4094, 37.7849],
					},
					properties: {
						name: "Another Point",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		expect(osm.nodes.size).toBe(2)
		expect(osm.ways.size).toBe(0)

		const node1 = osm.nodes.getById(-1)
		expect(node1).toBeDefined()
		expect(node1?.lon).toBe(-122.4194)
		expect(node1?.lat).toBe(37.7749)
		expect(node1?.tags?.["name"]).toBe("San Francisco")
		// OSM tags are stored as strings, so numbers are converted
		expect(node1?.tags?.["population"]).toBe("873965")

		const node2 = osm.nodes.getById(-2)
		expect(node2).toBeDefined()
		expect(node2?.lon).toBe(-122.4094)
		expect(node2?.lat).toBe(37.7849)
		expect(node2?.tags?.["name"]).toBe("Another Point")
	})

	it("should convert LineString features to Ways with Nodes", () => {
		const geojson: FeatureCollection<LineString> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: [
							[-122.4194, 37.7749],
							[-122.4094, 37.7849],
							[-122.3994, 37.7949],
						],
					},
					properties: {
						highway: "primary",
						name: "Main Street",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		expect(osm.nodes.size).toBe(3)
		expect(osm.ways.size).toBe(1)

		const way = osm.ways.getById(-1)
		expect(way).toBeDefined()
		expect(way?.refs).toHaveLength(3)
		expect(way?.tags?.["highway"]).toBe("primary")
		expect(way?.tags?.["name"]).toBe("Main Street")

		// Verify nodes were created
		const node1 = osm.nodes.getById(way!.refs[0]!)
		const node2 = osm.nodes.getById(way!.refs[1]!)
		const node3 = osm.nodes.getById(way!.refs[2]!)

		expect(node1?.lon).toBe(-122.4194)
		expect(node1?.lat).toBe(37.7749)
		expect(node2?.lon).toBe(-122.4094)
		expect(node2?.lat).toBe(37.7849)
		expect(node3?.lon).toBe(-122.3994)
		expect(node3?.lat).toBe(37.7949)
	})

	it("should use feature IDs when present", () => {
		const geojson: FeatureCollection<Point | LineString> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					id: 100,
					geometry: {
						type: "Point",
						coordinates: [-122.4194, 37.7749],
					},
					properties: {
						name: "Point with ID",
					},
				},
				{
					type: "Feature",
					id: "200",
					geometry: {
						type: "LineString",
						coordinates: [
							[-122.4194, 37.7749],
							[-122.4094, 37.7849],
						],
					},
					properties: {
						highway: "primary",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		// Point should use ID 100
		const node = osm.nodes.getById(100)
		expect(node).toBeDefined()
		expect(node?.tags?.["name"]).toBe("Point with ID")

		// Way should use ID 200
		const way = osm.ways.getById(200)
		expect(way).toBeDefined()
		expect(way?.tags?.["highway"]).toBe("primary")
	})

	it("should generate sequential IDs when feature IDs are not present", () => {
		const geojson: FeatureCollection<Point | LineString> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Point",
						coordinates: [-122.4194, 37.7749],
					},
					properties: {},
				},
				{
					type: "Feature",
					geometry: {
						type: "Point",
						coordinates: [-122.4094, 37.7849],
					},
					properties: {},
				},
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: [
							[-122.3994, 37.7949],
							[-122.3894, 37.8049],
						],
					},
					properties: {},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		// Nodes should have sequential IDs starting from 1
		expect(osm.nodes.getById(-1)).toBeDefined()
		expect(osm.nodes.getById(-2)).toBeDefined()
		expect(osm.nodes.getById(-3)).toBeDefined()
		expect(osm.nodes.getById(-4)).toBeDefined()

		// Way should have ID 1
		expect(osm.ways.getById(-1)).toBeDefined()
	})

	it("should convert all properties to OSM tags", () => {
		const geojson: FeatureCollection<Point> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Point",
						coordinates: [-122.4194, 37.7749],
					},
					properties: {
						name: "Test",
						population: 1000,
						boolean: true,
						nullValue: null,
						undefinedValue: undefined,
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		const node = osm.nodes.getById(-1)
		expect(node?.tags?.["name"]).toBe("Test")
		// OSM tags are stored as strings, so numbers are converted
		expect(node?.tags?.["population"]).toBe("1000")
		expect(node?.tags?.["boolean"]).toBe("true")
		expect(node?.tags?.["nullValue"]).toBeUndefined()
		expect(node?.tags?.["undefinedValue"]).toBeUndefined()
	})

	it("should create separate nodes when LineStrings share coordinates", () => {
		const geojson: FeatureCollection<LineString> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: [
							[-122.4194, 37.7749],
							[-122.4094, 37.7849],
						],
					},
					properties: {
						highway: "primary",
					},
				},
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: [
							[-122.4094, 37.7849], // Shared coordinate
							[-122.3994, 37.7949],
						],
					},
					properties: {
						highway: "secondary",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		// Should have 4 nodes (no deduplication)
		expect(osm.nodes.size).toBe(4)
		expect(osm.ways.size).toBe(2)

		const way1 = osm.ways.getById(-1)
		const way2 = osm.ways.getById(-2)

		// Each way should have its own nodes (no reuse)
		expect(way1?.refs).toHaveLength(2)
		expect(way2?.refs).toHaveLength(2)
		// Nodes at the same coordinate are separate
		expect(way1?.refs[1]).not.toBe(way2?.refs[0])
	})

	it("should skip invalid LineStrings with less than 2 coordinates", () => {
		const geojson: FeatureCollection<LineString> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: [[-122.4194, 37.7749]], // Only one coordinate
					},
					properties: {},
				},
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: [
							[-122.4194, 37.7749],
							[-122.4094, 37.7849],
						],
					},
					properties: {
						highway: "primary",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		// Should only have one way (the valid one)
		expect(osm.ways.size).toBe(1)
		expect(osm.ways.getById(-1)?.tags?.["highway"]).toBe("primary")
	})

	it("should error on LineStrings with invalid coordinates that result in less than 2 valid nodes", () => {
		const geojson: FeatureCollection<LineString> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: [
							[-122.4194, 37.7749], // Valid coordinate
							[undefined, undefined] as unknown as [number, number], // Invalid coordinate
						],
					},
					properties: {
						highway: "primary",
					},
				},
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: [
							[-122.4194, 37.7749],
							[-122.4094, 37.7849],
						],
					},
					properties: {
						highway: "secondary",
					},
				},
			],
		}

		expect(() => fromGeoJSON(geojson)).toThrow()
	})

	it("should handle mixed Point and LineString features", () => {
		const geojson: FeatureCollection<Point | LineString> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Point",
						coordinates: [-122.4194, 37.7749],
					},
					properties: {
						name: "Start Point",
					},
				},
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: [
							[-122.4194, 37.7749], // Same as point
							[-122.4094, 37.7849],
						],
					},
					properties: {
						highway: "primary",
					},
				},
				{
					type: "Feature",
					geometry: {
						type: "Point",
						coordinates: [-122.3994, 37.7949],
					},
					properties: {
						name: "End Point",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		// Should have 4 nodes (2 points + 2 nodes from LineString, no deduplication)
		expect(osm.nodes.size).toBe(4)
		expect(osm.ways.size).toBe(1)

		const way = osm.ways.getById(-1)
		expect(way?.refs).toHaveLength(2)
	})

	it("should build indexes after conversion", () => {
		const geojson: FeatureCollection<Point> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Point",
						coordinates: [-122.4194, 37.7749],
					},
					properties: {},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		expect(osm.isReady()).toBe(true)
		expect(osm.nodes.isReady).toBe(true)
		expect(osm.ways.isReady).toBe(true)
	})

	it("should handle features without properties", () => {
		const geojson: FeatureCollection<Point> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Point",
						coordinates: [-122.4194, 37.7749],
					},
					properties: null,
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		const node = osm.nodes.getById(-1)
		expect(node).toBeDefined()
		expect(node?.tags).toBeUndefined()
	})

	it("should set default ID when not provided in options", () => {
		const geojson: FeatureCollection<Point> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Point",
						coordinates: [-122.4194, 37.7749],
					},
					properties: {},
				},
			],
		}

		const osm = fromGeoJSON(geojson)
		expect(osm.id).toBe("geojson")

		const osmWithId = fromGeoJSON(geojson, { id: "custom-id" })
		expect(osmWithId.id).toBe("custom-id")
	})

	it("should convert Polygon features to Ways with area tags", () => {
		const geojson: FeatureCollection<Polygon> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[-122.4194, 37.7749],
								[-122.4094, 37.7749],
								[-122.4094, 37.7849],
								[-122.4194, 37.7849],
								[-122.4194, 37.7749], // Closed ring
							],
						],
					},
					properties: {
						building: "yes",
						name: "Test Building",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		expect(osm.nodes.size).toBe(4) // 4 unique nodes (last is duplicate)
		expect(osm.ways.size).toBe(1)

		const way = osm.ways.getById(1)
		expect(way).toBeDefined()
		expect(way?.tags?.["building"]).toBe("yes")
		expect(way?.tags?.["name"]).toBe("Test Building")
		expect(way?.tags?.["area"]).toBe("yes")
		expect(way?.refs).toHaveLength(5) // 4 nodes + closing node
		expect(way?.refs[0]).toBe(way?.refs[4]) // Ring is closed
	})

	it("should convert Polygon with holes to multiple Ways", () => {
		const geojson: FeatureCollection<Polygon> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Polygon",
						coordinates: [
							// Outer ring
							[
								[-122.4194, 37.7749],
								[-122.4094, 37.7749],
								[-122.4094, 37.7849],
								[-122.4194, 37.7849],
								[-122.4194, 37.7749],
							],
							// Hole
							[
								[-122.4164, 37.7779],
								[-122.4144, 37.7779],
								[-122.4144, 37.7799],
								[-122.4164, 37.7799],
								[-122.4164, 37.7779],
							],
						],
					},
					properties: {
						building: "yes",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		// Should have outer ring way + hole way
		expect(osm.ways.size).toBe(2)

		const outerWay = osm.ways.getById(1)
		expect(outerWay).toBeDefined()
		expect(outerWay?.tags?.["area"]).toBe("yes")
		expect(outerWay?.tags?.["building"]).toBe("yes")

		const holeWay = osm.ways.getById(2)
		expect(holeWay).toBeDefined()
		expect(holeWay?.tags?.["area"]).toBe("yes")
		expect(holeWay?.tags?.["building"]).toBe("yes")
	})

	it("should convert MultiPolygon features to multiple Ways", () => {
		const geojson: FeatureCollection<MultiPolygon> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "MultiPolygon",
						coordinates: [
							// First polygon
							[
								[
									[-122.4194, 37.7749],
									[-122.4094, 37.7749],
									[-122.4094, 37.7849],
									[-122.4194, 37.7849],
									[-122.4194, 37.7749],
								],
							],
							// Second polygon
							[
								[
									[-122.3994, 37.7649],
									[-122.3894, 37.7649],
									[-122.3894, 37.7749],
									[-122.3994, 37.7749],
									[-122.3994, 37.7649],
								],
							],
						],
					},
					properties: {
						landuse: "residential",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		// Should have 2 ways (one for each polygon)
		expect(osm.ways.size).toBe(2)

		const way1 = osm.ways.getById(1)
		expect(way1).toBeDefined()
		expect(way1?.tags?.["landuse"]).toBe("residential")
		expect(way1?.tags?.["area"]).toBe("yes")

		const way2 = osm.ways.getById(2)
		expect(way2).toBeDefined()
		expect(way2?.tags?.["landuse"]).toBe("residential")
		expect(way2?.tags?.["area"]).toBe("yes")
	})

	it("should convert MultiPolygon with holes to multiple Ways", () => {
		const geojson: FeatureCollection<MultiPolygon> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "MultiPolygon",
						coordinates: [
							// First polygon with hole
							[
								// Outer ring
								[
									[-122.4194, 37.7749],
									[-122.4094, 37.7749],
									[-122.4094, 37.7849],
									[-122.4194, 37.7849],
									[-122.4194, 37.7749],
								],
								// Hole
								[
									[-122.4164, 37.7779],
									[-122.4144, 37.7779],
									[-122.4144, 37.7799],
									[-122.4164, 37.7799],
									[-122.4164, 37.7779],
								],
							],
							// Second polygon (no holes)
							[
								[
									[-122.3994, 37.7649],
									[-122.3894, 37.7649],
									[-122.3894, 37.7749],
									[-122.3994, 37.7749],
									[-122.3994, 37.7649],
								],
							],
						],
					},
					properties: {
						landuse: "residential",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		// Should have 3 ways: outer ring of first polygon, hole of first polygon, second polygon
		expect(osm.ways.size).toBe(3)

		const outerWay = osm.ways.getById(1)
		expect(outerWay).toBeDefined()
		expect(outerWay?.tags?.["area"]).toBe("yes")

		const holeWay = osm.ways.getById(2)
		expect(holeWay).toBeDefined()
		expect(holeWay?.tags?.["area"]).toBe("yes")

		const secondPolyWay = osm.ways.getById(3)
		expect(secondPolyWay).toBeDefined()
		expect(secondPolyWay?.tags?.["area"]).toBe("yes")
	})

	it("should handle Polygon with unclosed ring by closing it", () => {
		const geojson: FeatureCollection<Polygon> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[-122.4194, 37.7749],
								[-122.4094, 37.7749],
								[-122.4094, 37.7849],
								[-122.4194, 37.7849],
								// Not closed - should be closed automatically
							],
						],
					},
					properties: {
						building: "yes",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		const way = osm.ways.getById(1)
		expect(way).toBeDefined()
		expect(way?.refs).toHaveLength(5) // 4 nodes + closing node
		expect(way?.refs[0]).toBe(way?.refs[4]) // Ring is closed
	})

	it("should skip invalid Polygons with less than 3 coordinates", () => {
		const geojson: FeatureCollection<Polygon> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[-122.4194, 37.7749],
								[-122.4094, 37.7749],
								// Only 2 coordinates - invalid
							],
						],
					},
					properties: {},
				},
				{
					type: "Feature",
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[-122.4194, 37.7749],
								[-122.4094, 37.7749],
								[-122.4094, 37.7849],
								[-122.4194, 37.7849],
								[-122.4194, 37.7749],
							],
						],
					},
					properties: {
						building: "yes",
					},
				},
			],
		}

		const osm = fromGeoJSON(geojson)

		// Should only have one way (the valid one)
		expect(osm.ways.size).toBe(1)
		expect(osm.ways.getById(1)?.tags?.["building"]).toBe("yes")
	})
})
