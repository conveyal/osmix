import type {
	FeatureCollection,
	LineString,
	MultiPolygon,
	Point,
	Polygon,
} from "geojson"
import { describe, expect, it } from "vitest"
import { fromGeoJSON } from "../src/geojson"
import { Osm } from "../src/osm"

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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

		const node = osm.nodes.getById(-1)
		expect(node?.tags?.["name"]).toBe("Test")
		// OSM tags are stored as strings, so numbers are converted
		expect(node?.tags?.["population"]).toBe("1000")
		expect(node?.tags?.["boolean"]).toBe("true")
		expect(node?.tags?.["nullValue"]).toBeUndefined()
		expect(node?.tags?.["undefinedValue"]).toBeUndefined()
	})

	it("should reuse nodes when LineStrings share coordinates", () => {
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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

		// Should have 3 nodes (shared coordinate is reused)
		expect(osm.nodes.size).toBe(3)
		expect(osm.ways.size).toBe(2)

		const way1 = osm.ways.getById(-1)
		const way2 = osm.ways.getById(-2)

		// Each way should have its own nodes
		expect(way1?.refs).toHaveLength(2)
		expect(way2?.refs).toHaveLength(2)
		// Nodes at the same coordinate are reused
		expect(way1?.refs[1]).toBe(way2?.refs[0])
	})

	it("should error on LineStrings with less than 2 coordinates", () => {
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
			],
		}

		const osm = new Osm()
		expect(() => fromGeoJSON(osm, geojson)).toThrow(
			"Invalid GeoJSON coordinates in LineString.",
		)
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

		const osm = new Osm()
		expect(() => fromGeoJSON(osm, geojson)).toThrow()
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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

		// Should have 3 nodes (point node is reused by LineString)
		expect(osm.nodes.size).toBe(3)
		expect(osm.ways.size).toBe(1)

		const way = osm.ways.getById(-1)
		expect(way?.refs).toHaveLength(2)
		// First node of way should be the same as the point node
		const pointNode = osm.nodes.getById(-1)
		expect(way?.refs[0]).toBe(-1)
		expect(pointNode?.lon).toBe(-122.4194)
		expect(pointNode?.lat).toBe(37.7749)
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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

		expect(osm.isReady()).toBe(true)
		expect(osm.nodes.isReady()).toBe(true)
		expect(osm.ways.isReady()).toBe(true)
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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

		const node = osm.nodes.getById(-1)
		expect(node).toBeDefined()
		expect(node?.tags).toBeUndefined()
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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

		expect(osm.nodes.size).toBe(4) // 4 unique nodes (last is duplicate)
		expect(osm.ways.size).toBe(1)
		expect(osm.relations.size).toBe(0) // No relation for simple polygon

		const way = osm.ways.getById(-1)
		expect(way).toBeDefined()
		expect(way?.tags?.["building"]).toBe("yes")
		expect(way?.tags?.["name"]).toBe("Test Building")
		expect(way?.tags?.["area"]).toBe("yes")
		expect(way?.refs).toHaveLength(5) // 4 nodes + closing node
		expect(way?.refs[0]).toBe(way?.refs[4]) // Ring is closed
	})

	it("should convert Polygon with holes to relation with multiple Ways", () => {
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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

		// Should have outer ring way + hole way + relation
		expect(osm.ways.size).toBe(2)
		expect(osm.relations.size).toBe(1)

		const outerWay = osm.ways.getById(-1)
		expect(outerWay).toBeDefined()
		expect(outerWay?.tags?.["area"]).toBe("yes")
		expect(outerWay?.tags?.["building"]).toBeUndefined() // Tags go on relation

		const holeWay = osm.ways.getById(-2)
		expect(holeWay).toBeDefined()
		expect(holeWay?.tags?.["area"]).toBe("yes")
		expect(holeWay?.tags?.["building"]).toBeUndefined() // Tags go on relation

		const relation = osm.relations.getById(-1)
		expect(relation).toBeDefined()
		expect(relation?.tags?.["type"]).toBe("multipolygon")
		expect(relation?.tags?.["building"]).toBe("yes")
		expect(relation?.members).toHaveLength(2)
		expect(relation?.members[0]?.type).toBe("way")
		expect(relation?.members[0]?.ref).toBe(-1)
		expect(relation?.members[0]?.role).toBe("outer")
		expect(relation?.members[1]?.type).toBe("way")
		expect(relation?.members[1]?.ref).toBe(-2)
		expect(relation?.members[1]?.role).toBe("inner")
	})

	it("should convert MultiPolygon features to relation with multiple Ways", () => {
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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

		// Should have 2 ways + 1 relation
		expect(osm.ways.size).toBe(2)
		expect(osm.relations.size).toBe(1)

		const way1 = osm.ways.getById(-1)
		expect(way1).toBeDefined()
		expect(way1?.tags?.["landuse"]).toBeUndefined() // Tags go on relation
		expect(way1?.tags?.["area"]).toBe("yes")

		const way2 = osm.ways.getById(-2)
		expect(way2).toBeDefined()
		expect(way2?.tags?.["landuse"]).toBeUndefined() // Tags go on relation
		expect(way2?.tags?.["area"]).toBe("yes")

		const relation = osm.relations.getById(-1)
		expect(relation).toBeDefined()
		expect(relation?.tags?.["type"]).toBe("multipolygon")
		expect(relation?.tags?.["landuse"]).toBe("residential")
		expect(relation?.members).toHaveLength(2)
		expect(relation?.members[0]?.type).toBe("way")
		expect(relation?.members[0]?.ref).toBe(-1)
		expect(relation?.members[0]?.role).toBe("outer")
		expect(relation?.members[1]?.type).toBe("way")
		expect(relation?.members[1]?.ref).toBe(-2)
		expect(relation?.members[1]?.role).toBe("outer")
	})

	it("should convert MultiPolygon with holes to relation with multiple Ways", () => {
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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

		// Should have 3 ways + 1 relation
		expect(osm.ways.size).toBe(3)
		expect(osm.relations.size).toBe(1)

		const outerWay = osm.ways.getById(-1)
		expect(outerWay).toBeDefined()
		expect(outerWay?.tags?.["area"]).toBe("yes")

		const holeWay = osm.ways.getById(-2)
		expect(holeWay).toBeDefined()
		expect(holeWay?.tags?.["area"]).toBe("yes")

		const secondPolyWay = osm.ways.getById(-3)
		expect(secondPolyWay).toBeDefined()
		expect(secondPolyWay?.tags?.["area"]).toBe("yes")

		const relation = osm.relations.getById(-1)
		expect(relation).toBeDefined()
		expect(relation?.tags?.["type"]).toBe("multipolygon")
		expect(relation?.tags?.["landuse"]).toBe("residential")
		expect(relation?.members).toHaveLength(3)
		expect(relation?.members[0]?.type).toBe("way")
		expect(relation?.members[0]?.ref).toBe(-1)
		expect(relation?.members[0]?.role).toBe("outer")
		expect(relation?.members[1]?.type).toBe("way")
		expect(relation?.members[1]?.ref).toBe(-2)
		expect(relation?.members[1]?.role).toBe("inner")
		expect(relation?.members[2]?.type).toBe("way")
		expect(relation?.members[2]?.ref).toBe(-3)
		expect(relation?.members[2]?.role).toBe("outer")
	})

	it("should error on Polygon with unclosed ring", () => {
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
								// Not closed - should throw error
							],
						],
					},
					properties: {
						building: "yes",
					},
				},
			],
		}

		expect(() => fromGeoJSON(new Osm(), geojson)).toThrow(
			"Outer ring of Polygon is not closed.",
		)
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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

		// Should only have one way (the valid one)
		expect(osm.ways.size).toBe(1)
		expect(osm.ways.getById(-1)?.tags?.["building"]).toBe("yes")
	})

	it("should normalize winding order using rewind", () => {
		// Create a polygon with clockwise winding (should be normalized to counterclockwise)
		const geojson: FeatureCollection<Polygon> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Polygon",
						coordinates: [
							// Clockwise ring (will be normalized by rewind)
							[
								[-122.4194, 37.7749],
								[-122.4194, 37.7849],
								[-122.4094, 37.7849],
								[-122.4094, 37.7749],
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

		const osm = new Osm()
		fromGeoJSON(osm, geojson)

		// Should still create the way successfully (rewind normalizes winding)
		expect(osm.ways.size).toBe(1)
		const way = osm.ways.getById(-1)
		expect(way).toBeDefined()
		expect(way?.tags?.["building"]).toBe("yes")
		expect(way?.tags?.["area"]).toBe("yes")
	})

	it("should error on unclosed hole ring", () => {
		const geojson: FeatureCollection<Polygon> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "Polygon",
						coordinates: [
							// Outer ring (closed)
							[
								[-122.4194, 37.7749],
								[-122.4094, 37.7749],
								[-122.4094, 37.7849],
								[-122.4194, 37.7849],
								[-122.4194, 37.7749],
							],
							// Hole ring (not closed - should throw error)
							[
								[-122.4164, 37.7779],
								[-122.4144, 37.7779],
								[-122.4144, 37.7799],
								[-122.4164, 37.7799],
								// Missing closing coordinate
							],
						],
					},
					properties: {
						building: "yes",
					},
				},
			],
		}

		expect(() => fromGeoJSON(new Osm(), geojson)).toThrow(
			"Hole ring of Polygon is not closed.",
		)
	})

	it("should error on unclosed MultiPolygon ring", () => {
		const geojson: FeatureCollection<MultiPolygon> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "MultiPolygon",
						coordinates: [
							[
								[
									[-122.4194, 37.7749],
									[-122.4094, 37.7749],
									[-122.4094, 37.7849],
									[-122.4194, 37.7849],
									// Not closed - should throw error
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

		expect(() => fromGeoJSON(new Osm(), geojson)).toThrow(
			"Outer ring of Polygon is not closed.",
		)
	})
})
