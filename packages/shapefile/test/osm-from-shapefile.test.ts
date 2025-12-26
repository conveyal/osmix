import { describe, expect, it, mock } from "bun:test"
import { Osm } from "@osmix/core"
import { progressEventMessage } from "@osmix/shared/progress"
import type { FeatureCollection, LineString, Point, Polygon } from "geojson"
import { startCreateOsmFromShapefile } from "../src/osm-from-shapefile"

// Mock shpjs module
mock.module("shpjs", () => ({
	default: async (input: unknown) => {
		// Return the mock data passed through
		return input as FeatureCollection
	},
}))

describe("@osmix/shapefile: startCreateOsmFromShapefile", () => {
	it("should convert Point features to Nodes", () => {
		const osm = new Osm()
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

		for (const _ of startCreateOsmFromShapefile(osm, geojson, "test")) {
			// Consume generator
		}
		osm.buildIndexes()

		expect(osm.nodes.size).toBe(2)
		expect(osm.ways.size).toBe(0)

		const node1 = osm.nodes.getById(-1)
		expect(node1).toBeDefined()
		expect(node1?.lon).toBe(-122.4194)
		expect(node1?.lat).toBe(37.7749)
		expect(node1?.tags?.["name"]).toBe("San Francisco")
		// OSM tags are stored as strings
		expect(node1?.tags?.["population"]).toBe("873965")

		const node2 = osm.nodes.getById(-2)
		expect(node2).toBeDefined()
		expect(node2?.lon).toBe(-122.4094)
		expect(node2?.lat).toBe(37.7849)
		expect(node2?.tags?.["name"]).toBe("Another Point")
	})

	it("should convert LineString features to Ways with Nodes", () => {
		const osm = new Osm()
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

		for (const _ of startCreateOsmFromShapefile(osm, geojson, "test")) {
			// Consume generator
		}
		osm.buildIndexes()

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

	it("should convert simple Polygon features to Ways with area tags", () => {
		const osm = new Osm()
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

		for (const _ of startCreateOsmFromShapefile(osm, geojson, "test")) {
			// Consume generator
		}
		osm.buildIndexes()

		expect(osm.ways.size).toBe(1)
		expect(osm.relations.size).toBe(0) // No relation for simple polygon

		const way = osm.ways.getById(-1)
		expect(way).toBeDefined()
		expect(way?.tags?.["building"]).toBe("yes")
		expect(way?.tags?.["name"]).toBe("Test Building")
		expect(way?.tags?.["area"]).toBe("yes")
	})

	it("should convert Polygon with holes to relation with multiple Ways", () => {
		const osm = new Osm()
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

		for (const _ of startCreateOsmFromShapefile(osm, geojson, "test")) {
			// Consume generator
		}
		osm.buildIndexes()

		// Should have outer ring way + hole way + relation
		expect(osm.ways.size).toBe(2)
		expect(osm.relations.size).toBe(1)

		const relation = osm.relations.getById(-1)
		expect(relation).toBeDefined()
		expect(relation?.tags?.["type"]).toBe("multipolygon")
		expect(relation?.tags?.["building"]).toBe("yes")
		expect(relation?.members).toHaveLength(2)
		expect(relation?.members[0]?.role).toBe("outer")
		expect(relation?.members[1]?.role).toBe("inner")
	})

	it("should convert MultiPoint features to multiple Nodes", () => {
		const osm = new Osm()
		const geojson: FeatureCollection = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "MultiPoint",
						coordinates: [
							[-122.4194, 37.7749],
							[-122.4094, 37.7849],
							[-122.3994, 37.7949],
						],
					},
					properties: {
						type: "stop",
					},
				},
			],
		}

		for (const _ of startCreateOsmFromShapefile(osm, geojson, "test")) {
			// Consume generator
		}
		osm.buildIndexes()

		expect(osm.nodes.size).toBe(3)
		expect(osm.ways.size).toBe(0)

		// All three nodes should have the same tags
		const node1 = osm.nodes.getById(-1)
		const node2 = osm.nodes.getById(-2)
		const node3 = osm.nodes.getById(-3)

		expect(node1?.tags?.["type"]).toBe("stop")
		expect(node2?.tags?.["type"]).toBe("stop")
		expect(node3?.tags?.["type"]).toBe("stop")
	})

	it("should handle features without properties", () => {
		const osm = new Osm()
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

		for (const _ of startCreateOsmFromShapefile(osm, geojson, "test")) {
			// Consume generator
		}
		osm.buildIndexes()

		expect(osm.nodes.size).toBe(1)
		const node = osm.nodes.getById(-1)
		expect(node).toBeDefined()
		expect(node?.tags).toBeUndefined()
	})

	it("should reuse nodes when features share coordinates", () => {
		const osm = new Osm()
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

		for (const _ of startCreateOsmFromShapefile(osm, geojson, "test")) {
			// Consume generator
		}
		osm.buildIndexes()

		// Should have 3 nodes (shared coordinate is reused)
		expect(osm.nodes.size).toBe(3)
		expect(osm.ways.size).toBe(2)

		const way1 = osm.ways.getById(-1)
		const way2 = osm.ways.getById(-2)

		// Each way should have 2 nodes
		expect(way1?.refs).toHaveLength(2)
		expect(way2?.refs).toHaveLength(2)
		// Nodes at the same coordinate are reused
		expect(way1?.refs[1]).toBe(way2?.refs[0])
	})

	it("should use generator for custom progress handling", () => {
		const osm = new Osm()
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

		const progressMessages: string[] = []
		for (const update of startCreateOsmFromShapefile(osm, geojson, "test")) {
			progressMessages.push(progressEventMessage(update))
		}

		expect(progressMessages.length).toBeGreaterThan(0)
		expect(progressMessages[0]).toContain("Converting")
		expect(progressMessages[progressMessages.length - 1]).toContain(
			"Finished converting",
		)
	})

	it("should use feature IDs when present", () => {
		const osm = new Osm()
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

		for (const _ of startCreateOsmFromShapefile(osm, geojson, "test")) {
			// Consume generator
		}
		osm.buildIndexes()

		// Point should use ID 100
		const node = osm.nodes.getById(100)
		expect(node).toBeDefined()
		expect(node?.tags?.["name"]).toBe("Point with ID")

		// Way should use ID 200
		const way = osm.ways.getById(200)
		expect(way).toBeDefined()
		expect(way?.tags?.["highway"]).toBe("primary")
	})

	it("should handle MultiLineString features", () => {
		const osm = new Osm()
		const geojson: FeatureCollection = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "MultiLineString",
						coordinates: [
							[
								[-122.4194, 37.7749],
								[-122.4094, 37.7849],
							],
							[
								[-122.3994, 37.7949],
								[-122.3894, 37.8049],
							],
						],
					},
					properties: {
						highway: "secondary",
					},
				},
			],
		}

		for (const _ of startCreateOsmFromShapefile(osm, geojson, "test")) {
			// Consume generator
		}
		osm.buildIndexes()

		// Should create 2 ways (one for each line)
		expect(osm.ways.size).toBe(2)
		expect(osm.nodes.size).toBe(4)

		const way1 = osm.ways.getById(-1)
		const way2 = osm.ways.getById(-2)

		expect(way1?.refs).toHaveLength(2)
		expect(way2?.refs).toHaveLength(2)
		expect(way1?.tags?.["highway"]).toBe("secondary")
		expect(way2?.tags?.["highway"]).toBe("secondary")
	})

	it("should handle MultiPolygon features", () => {
		const osm = new Osm()
		const geojson: FeatureCollection = {
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

		for (const _ of startCreateOsmFromShapefile(osm, geojson, "test")) {
			// Consume generator
		}
		osm.buildIndexes()

		// Should have 2 ways + 1 relation
		expect(osm.ways.size).toBe(2)
		expect(osm.relations.size).toBe(1)

		const relation = osm.relations.getById(-1)
		expect(relation).toBeDefined()
		expect(relation?.tags?.["type"]).toBe("multipolygon")
		expect(relation?.tags?.["landuse"]).toBe("residential")
		expect(relation?.members).toHaveLength(2)
		expect(relation?.members[0]?.role).toBe("outer")
		expect(relation?.members[1]?.role).toBe("outer")
	})
})
