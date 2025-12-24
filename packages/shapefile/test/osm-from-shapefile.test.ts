import { describe, expect, it } from "bun:test"
import { Osm } from "@osmix/core"
import { progressEventMessage } from "@osmix/shared/progress"
import type {
	Dbase,
	DbaseField,
	DbaseVersion,
	Shape,
	Shapefile,
	ShapeMultiPoint,
	ShapePoint,
	ShapePolygon,
	ShapePolyline,
} from "shapefile.js"
import { ShapeType } from "shapefile.js"
import {
	fromShapefile,
	startCreateOsmFromShapefile,
} from "../src/osm-from-shapefile"

// Helper to create a mock Shapefile object
function createMockShapefile(
	shape: Shape,
	dbf: Dbase<DbaseVersion, true>,
): Shapefile {
	return {
		contents: {} as any,
		parse: ((key: string, _options?: any) => {
			if (key === "shp") return shape
			if (key === "dbf") return dbf
			return null
		}) as any,
	} as Shapefile
}

// Helper to create an empty DBF
function createEmptyDbf(): Dbase<DbaseVersion, true> {
	return {
		header: {} as any,
		fields: [],
	}
}

// Helper to create a DBF with fields
function createDbf(
	fields: Array<{ name: string; properties: any[] }>,
): Dbase<DbaseVersion, true> {
	return {
		header: {} as any,
		fields: fields.map((f) => ({
			name: f.name,
			type: "C",
			length: 50,
			decimals: 0,
			properties: f.properties,
		})) as DbaseField<DbaseVersion, true>[],
	}
}

// Helper to create a bounding box
function bbox(minX: number, minY: number, maxX: number, maxY: number) {
	return { minX, minY, maxX, maxY }
}

// Helper to create a record header
function header(num: number, len: number) {
	return { number: num, length: len }
}

describe("@osmix/shapefile: fromShapefile", () => {
	it("should convert Point shapes to Nodes", async () => {
		const shape: Shape = {
			header: { shapeType: ShapeType.Point } as any,
			records: [
				{
					header: header(1, 10),
					body: {
						type: ShapeType.Point,
						data: { x: -122.4194, y: 37.7749 } as ShapePoint,
					},
				},
				{
					header: header(2, 10),
					body: {
						type: ShapeType.Point,
						data: { x: -122.4094, y: 37.7849 } as ShapePoint,
					},
				},
			],
		}

		const dbf = createDbf([
			{ name: "name", properties: ["San Francisco", "Another Point"] },
			{ name: "population", properties: [873965, 50000] },
		])

		const shapefile = createMockShapefile(shape, dbf)
		const osm = await fromShapefile({ test: shapefile })

		expect(osm.nodes.size).toBe(2)
		expect(osm.ways.size).toBe(0)

		const node1 = osm.nodes.getById(-1)
		expect(node1).toBeDefined()
		expect(node1?.lon).toBe(-122.4194)
		expect(node1?.lat).toBe(37.7749)
		expect(node1?.tags?.["name"]).toBe("San Francisco")
		// OSM tags are stored as strings in the Tags class
		expect(node1?.tags?.["population"]).toBe("873965")

		const node2 = osm.nodes.getById(-2)
		expect(node2).toBeDefined()
		expect(node2?.lon).toBe(-122.4094)
		expect(node2?.lat).toBe(37.7849)
		expect(node2?.tags?.["name"]).toBe("Another Point")
	})

	it("should convert Polyline shapes to Ways with Nodes", async () => {
		const shape: Shape = {
			header: { shapeType: ShapeType.Polyline } as any,
			records: [
				{
					header: header(1, 100),
					body: {
						type: ShapeType.Polyline,
						data: {
							boundingBox: bbox(-122.42, 37.77, -122.39, 37.8),
							numberOfParts: 1,
							numberOfPoints: 3,
							parts: [0],
							points: [
								{ x: -122.4194, y: 37.7749 },
								{ x: -122.4094, y: 37.7849 },
								{ x: -122.3994, y: 37.7949 },
							],
						} as ShapePolyline,
					},
				},
			],
		}

		const dbf = createDbf([
			{ name: "highway", properties: ["primary"] },
			{ name: "name", properties: ["Main Street"] },
		])

		const shapefile = createMockShapefile(shape, dbf)
		const osm = await fromShapefile({ test: shapefile })

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

	it("should convert simple Polygon shapes to Ways with area tags", async () => {
		// Simple polygon: clockwise outer ring (will be normalized by rewind)
		const shape: Shape = {
			header: { shapeType: ShapeType.Polygon } as any,
			records: [
				{
					header: header(1, 100),
					body: {
						type: ShapeType.Polygon,
						data: {
							boundingBox: bbox(-122.42, 37.77, -122.4, 37.79),
							numberOfParts: 1,
							numberOfPoints: 5,
							parts: [0],
							// Points stored as flat array [x1, y1, x2, y2, ...]
							points: [
								-122.4194,
								37.7749,
								-122.4094,
								37.7749,
								-122.4094,
								37.7849,
								-122.4194,
								37.7849,
								-122.4194,
								37.7749, // Closed ring
							],
						} as ShapePolygon,
					},
				},
			],
		}

		const dbf = createDbf([
			{ name: "building", properties: ["yes"] },
			{ name: "name", properties: ["Test Building"] },
		])

		const shapefile = createMockShapefile(shape, dbf)
		const osm = await fromShapefile({ test: shapefile })

		expect(osm.ways.size).toBe(1)
		expect(osm.relations.size).toBe(0) // No relation for simple polygon

		const way = osm.ways.getById(-1)
		expect(way).toBeDefined()
		expect(way?.tags?.["building"]).toBe("yes")
		expect(way?.tags?.["name"]).toBe("Test Building")
		expect(way?.tags?.["area"]).toBe("yes")
	})

	it("should convert Polygon with holes to relation with multiple Ways", async () => {
		// Polygon with outer ring and one hole
		const shape: Shape = {
			header: { shapeType: ShapeType.Polygon } as any,
			records: [
				{
					header: header(1, 200),
					body: {
						type: ShapeType.Polygon,
						data: {
							boundingBox: bbox(-122.42, 37.77, -122.4, 37.79),
							numberOfParts: 2,
							numberOfPoints: 10,
							parts: [0, 5], // First ring at index 0, second at index 5
							// Flat points array
							points: [
								// Outer ring (5 points)
								-122.4194, 37.7749, -122.4094, 37.7749, -122.4094, 37.7849,
								-122.4194, 37.7849, -122.4194, 37.7749,
								// Inner ring/hole (5 points)
								-122.4164, 37.7779, -122.4144, 37.7779, -122.4144, 37.7799,
								-122.4164, 37.7799, -122.4164, 37.7779,
							],
						} as ShapePolygon,
					},
				},
			],
		}

		const dbf = createDbf([{ name: "building", properties: ["yes"] }])

		const shapefile = createMockShapefile(shape, dbf)
		const osm = await fromShapefile({ test: shapefile })

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

	it("should convert MultiPoint shapes to multiple Nodes", async () => {
		const shape: Shape = {
			header: { shapeType: ShapeType.MultiPoint } as any,
			records: [
				{
					header: header(1, 50),
					body: {
						type: ShapeType.MultiPoint,
						data: {
							boundingBox: bbox(-122.42, 37.77, -122.39, 37.8),
							numberOfPoints: 3,
							points: [
								{ x: -122.4194, y: 37.7749 },
								{ x: -122.4094, y: 37.7849 },
								{ x: -122.3994, y: 37.7949 },
							],
						} as ShapeMultiPoint,
					},
				},
			],
		}

		const dbf = createDbf([{ name: "type", properties: ["stop"] }])

		const shapefile = createMockShapefile(shape, dbf)
		const osm = await fromShapefile({ test: shapefile })

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

	it("should handle shapes without attributes", async () => {
		const shape: Shape = {
			header: { shapeType: ShapeType.Point } as any,
			records: [
				{
					header: header(1, 10),
					body: {
						type: ShapeType.Point,
						data: { x: -122.4194, y: 37.7749 } as ShapePoint,
					},
				},
			],
		}

		const dbf = createEmptyDbf()

		const shapefile = createMockShapefile(shape, dbf)
		const osm = await fromShapefile({ test: shapefile })

		expect(osm.nodes.size).toBe(1)
		const node = osm.nodes.getById(-1)
		expect(node).toBeDefined()
		expect(node?.tags).toBeUndefined()
	})

	it("should skip Null shapes", async () => {
		const shape: Shape = {
			header: { shapeType: ShapeType.Null } as any,
			records: [
				{
					header: header(1, 0),
					body: {
						type: ShapeType.Null,
						data: null,
					},
				},
				{
					header: header(2, 10),
					body: {
						type: ShapeType.Point,
						data: { x: -122.4194, y: 37.7749 } as ShapePoint,
					},
				},
			],
		}

		const dbf = createEmptyDbf()

		const shapefile = createMockShapefile(shape, dbf)
		const osm = await fromShapefile({ test: shapefile })

		expect(osm.nodes.size).toBe(1) // Only the Point, not the Null
	})

	it("should build indexes after conversion", async () => {
		const shape: Shape = {
			header: { shapeType: ShapeType.Point } as any,
			records: [
				{
					header: header(1, 10),
					body: {
						type: ShapeType.Point,
						data: { x: -122.4194, y: 37.7749 } as ShapePoint,
					},
				},
			],
		}

		const dbf = createEmptyDbf()

		const shapefile = createMockShapefile(shape, dbf)
		const osm = await fromShapefile({ test: shapefile })

		expect(osm.isReady()).toBe(true)
		expect(osm.nodes.isReady()).toBe(true)
		expect(osm.ways.isReady()).toBe(true)
	})

	it("should handle PointZ and PointM shapes", async () => {
		const shape: Shape = {
			header: { shapeType: ShapeType.PointZ } as any,
			records: [
				{
					header: header(1, 20),
					body: {
						type: ShapeType.PointZ,
						data: { x: -122.4194, y: 37.7749, z: 100, m: 0 } as any,
					},
				},
				{
					header: header(2, 20),
					body: {
						type: ShapeType.PointM,
						data: { x: -122.4094, y: 37.7849, m: 50 } as any,
					},
				},
			],
		}

		const dbf = createEmptyDbf()

		const shapefile = createMockShapefile(shape, dbf)
		const osm = await fromShapefile({ test: shapefile })

		expect(osm.nodes.size).toBe(2)
	})

	it("should reuse nodes when shapes share coordinates", async () => {
		const shape: Shape = {
			header: { shapeType: ShapeType.Polyline } as any,
			records: [
				{
					header: header(1, 50),
					body: {
						type: ShapeType.Polyline,
						data: {
							boundingBox: bbox(-122.42, 37.77, -122.39, 37.8),
							numberOfParts: 1,
							numberOfPoints: 2,
							parts: [0],
							points: [
								{ x: -122.4194, y: 37.7749 },
								{ x: -122.4094, y: 37.7849 },
							],
						} as ShapePolyline,
					},
				},
				{
					header: header(2, 50),
					body: {
						type: ShapeType.Polyline,
						data: {
							boundingBox: bbox(-122.41, 37.78, -122.39, 37.8),
							numberOfParts: 1,
							numberOfPoints: 2,
							parts: [0],
							points: [
								{ x: -122.4094, y: 37.7849 }, // Shared coordinate
								{ x: -122.3994, y: 37.7949 },
							],
						} as ShapePolyline,
					},
				},
			],
		}

		const dbf = createEmptyDbf()

		const shapefile = createMockShapefile(shape, dbf)
		const osm = await fromShapefile({ test: shapefile })

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

	it("should handle multi-part polylines", async () => {
		const shape: Shape = {
			header: { shapeType: ShapeType.Polyline } as any,
			records: [
				{
					header: header(1, 100),
					body: {
						type: ShapeType.Polyline,
						data: {
							boundingBox: bbox(-122.42, 37.77, -122.39, 37.8),
							numberOfParts: 2,
							numberOfPoints: 4,
							parts: [0, 2], // First part at 0, second at 2
							points: [
								{ x: -122.4194, y: 37.7749 },
								{ x: -122.4094, y: 37.7849 },
								{ x: -122.3994, y: 37.7949 },
								{ x: -122.3894, y: 37.8049 },
							],
						} as ShapePolyline,
					},
				},
			],
		}

		const dbf = createDbf([{ name: "highway", properties: ["secondary"] }])

		const shapefile = createMockShapefile(shape, dbf)
		const osm = await fromShapefile({ test: shapefile })

		// Should create 2 ways (one for each part)
		expect(osm.ways.size).toBe(2)
		expect(osm.nodes.size).toBe(4)

		const way1 = osm.ways.getById(-1)
		const way2 = osm.ways.getById(-2)

		expect(way1?.refs).toHaveLength(2)
		expect(way2?.refs).toHaveLength(2)
		expect(way1?.tags?.["highway"]).toBe("secondary")
		expect(way2?.tags?.["highway"]).toBe("secondary")
	})

	it("should use generator for custom progress handling", () => {
		const osm = new Osm()
		const shape: Shape = {
			header: { shapeType: ShapeType.Point } as any,
			records: [
				{
					header: header(1, 10),
					body: {
						type: ShapeType.Point,
						data: { x: -122.4194, y: 37.7749 } as ShapePoint,
					},
				},
			],
		}

		const dbf = createEmptyDbf()
		const shapefile = createMockShapefile(shape, dbf)

		const progressMessages: string[] = []
		for (const update of startCreateOsmFromShapefile(osm, shapefile, "test")) {
			progressMessages.push(progressEventMessage(update))
		}

		expect(progressMessages.length).toBeGreaterThan(0)
		expect(progressMessages[0]).toContain("Converting Shapefile")
		expect(progressMessages[progressMessages.length - 1]).toContain(
			"Finished converting",
		)
	})

	it("should handle multiple shapefiles in one import", async () => {
		const shape1: Shape = {
			header: { shapeType: ShapeType.Point } as any,
			records: [
				{
					header: header(1, 10),
					body: {
						type: ShapeType.Point,
						data: { x: -122.4194, y: 37.7749 } as ShapePoint,
					},
				},
			],
		}

		const shape2: Shape = {
			header: { shapeType: ShapeType.Point } as any,
			records: [
				{
					header: header(1, 10),
					body: {
						type: ShapeType.Point,
						data: { x: -122.4094, y: 37.7849 } as ShapePoint,
					},
				},
			],
		}

		const dbf = createEmptyDbf()

		const shapefiles = {
			first: createMockShapefile(shape1, dbf),
			second: createMockShapefile(shape2, dbf),
		}

		const osm = await fromShapefile(shapefiles)

		// Both shapefiles should be imported
		expect(osm.nodes.size).toBe(2)
	})
})
