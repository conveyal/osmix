import { describe, expect, it } from "bun:test"
import { GeoParquetOsmBuilder } from "../src/from-layercake"
import type { GeoParquetRow } from "../src/types"

/**
 * Create WKB Point geometry.
 */
function createPointWkb(lon: number, lat: number): Uint8Array {
	const buffer = new ArrayBuffer(21)
	const view = new DataView(buffer)
	let offset = 0

	view.setUint8(offset, 1) // little endian
	offset += 1
	view.setUint32(offset, 1, true) // Point type
	offset += 4
	view.setFloat64(offset, lon, true)
	offset += 8
	view.setFloat64(offset, lat, true)

	return new Uint8Array(buffer)
}

/**
 * Create WKB LineString geometry.
 */
function createLineStringWkb(coords: [number, number][]): Uint8Array {
	const buffer = new ArrayBuffer(1 + 4 + 4 + coords.length * 16)
	const view = new DataView(buffer)
	let offset = 0

	view.setUint8(offset, 1) // little endian
	offset += 1
	view.setUint32(offset, 2, true) // LineString type
	offset += 4
	view.setUint32(offset, coords.length, true) // num points
	offset += 4

	for (const [lon, lat] of coords) {
		view.setFloat64(offset, lon, true)
		offset += 8
		view.setFloat64(offset, lat, true)
		offset += 8
	}

	return new Uint8Array(buffer)
}

/**
 * Create WKB Polygon geometry.
 */
function createPolygonWkb(rings: [number, number][][]): Uint8Array {
	const totalPoints = rings.reduce((sum, ring) => sum + ring.length, 0)
	const buffer = new ArrayBuffer(
		1 + 4 + 4 + rings.length * 4 + totalPoints * 16,
	)
	const view = new DataView(buffer)
	let offset = 0

	view.setUint8(offset, 1) // little endian
	offset += 1
	view.setUint32(offset, 3, true) // Polygon type
	offset += 4
	view.setUint32(offset, rings.length, true) // num rings
	offset += 4

	for (const ring of rings) {
		view.setUint32(offset, ring.length, true)
		offset += 4
		for (const [lon, lat] of ring) {
			view.setFloat64(offset, lon, true)
			offset += 8
			view.setFloat64(offset, lat, true)
			offset += 8
		}
	}

	return new Uint8Array(buffer)
}

/**
 * Helper function to process rows using the builder.
 */
function processRows(
	rows: GeoParquetRow[],
	options?: { idColumn?: string; geometryColumn?: string; tagsColumn?: string },
) {
	const builder = new GeoParquetOsmBuilder({}, options, () => {})
	builder.processGeoParquetRows(rows as unknown as Record<string, unknown>[])
	return builder.buildOsm()
}

describe("@osmix/layercake: GeoParquetOsmBuilder", () => {
	it("should convert Point features to Nodes", () => {
		const rows: GeoParquetRow[] = [
			{
				type: "node",
				id: 100n,
				geometry: createPointWkb(-122.4194, 37.7749),
				tags: { name: "San Francisco", population: "873965" },
				bbox: [-122.4194, 37.7749, -122.4194, 37.7749],
			},
			{
				type: "node",
				id: 200n,
				geometry: createPointWkb(-122.4094, 37.7849),
				tags: { name: "Another Point" },
				bbox: [-122.4094, 37.7849, -122.4094, 37.7849],
			},
		]

		const osm = processRows(rows)

		expect(osm.nodes.size).toBe(2)
		expect(osm.ways.size).toBe(0)

		// Get nodes by index to check values
		const node1 = osm.nodes.getByIndex(0)
		const node2 = osm.nodes.getByIndex(1)

		expect(node1).toBeDefined()
		expect(node1?.lon).toBeCloseTo(-122.4194, 4)
		expect(node1?.lat).toBeCloseTo(37.7749, 4)
		expect(node1?.tags?.["name"]).toBe("San Francisco")
		expect(node1?.tags?.["population"]).toBe("873965")

		expect(node2).toBeDefined()
		expect(node2?.lon).toBeCloseTo(-122.4094, 4)
		expect(node2?.lat).toBeCloseTo(37.7849, 4)
	})

	it("should convert Point features to Nodes with auto-generated IDs", () => {
		const rows: GeoParquetRow[] = [
			{
				type: "node",
				id: undefined as unknown as bigint, // No ID provided
				geometry: createPointWkb(-122.4194, 37.7749),
				tags: { name: "San Francisco" },
				bbox: [-122.4194, 37.7749, -122.4194, 37.7749],
			},
		]

		const osm = processRows(rows)

		expect(osm.nodes.size).toBe(1)

		// Auto-generated IDs start at -1
		const node = osm.nodes.getById(-1)
		expect(node).toBeDefined()
		expect(node?.lon).toBeCloseTo(-122.4194, 4)
		expect(node?.lat).toBeCloseTo(37.7749, 4)
		expect(node?.tags?.["name"]).toBe("San Francisco")
	})

	it("should convert LineString features to Ways with Nodes", () => {
		const rows: GeoParquetRow[] = [
			{
				type: "way",
				id: undefined as unknown as bigint, // Auto-generate IDs
				geometry: createLineStringWkb([
					[-122.4194, 37.7749],
					[-122.4094, 37.7849],
					[-122.3994, 37.7949],
				]),
				tags: { highway: "primary", name: "Main Street" },
				bbox: [-122.4194, 37.7749, -122.3994, 37.7949],
			},
		]

		const osm = processRows(rows)

		expect(osm.nodes.size).toBe(3)
		expect(osm.ways.size).toBe(1)

		const way = osm.ways.getById(-1)
		expect(way).toBeDefined()
		expect(way?.refs).toHaveLength(3)
		expect(way?.tags?.["highway"]).toBe("primary")
		expect(way?.tags?.["name"]).toBe("Main Street")

		// Verify nodes were created with auto-generated IDs
		const node1 = osm.nodes.getById(way!.refs[0]!)
		const node2 = osm.nodes.getById(way!.refs[1]!)
		const node3 = osm.nodes.getById(way!.refs[2]!)

		expect(node1?.lon).toBeCloseTo(-122.4194, 4)
		expect(node1?.lat).toBeCloseTo(37.7749, 4)
		expect(node2?.lon).toBeCloseTo(-122.4094, 4)
		expect(node2?.lat).toBeCloseTo(37.7849, 4)
		expect(node3?.lon).toBeCloseTo(-122.3994, 4)
		expect(node3?.lat).toBeCloseTo(37.7949, 4)
	})

	it("should convert Polygon features to Ways with area tags", () => {
		const rows: GeoParquetRow[] = [
			{
				type: "way",
				id: undefined as unknown as bigint, // Auto-generate IDs
				geometry: createPolygonWkb([
					[
						[-122.4194, 37.7749],
						[-122.4094, 37.7749],
						[-122.4094, 37.7849],
						[-122.4194, 37.7849],
						[-122.4194, 37.7749], // closed
					],
				]),
				tags: { building: "yes", name: "Test Building" },
				bbox: [-122.4194, 37.7749, -122.4094, 37.7849],
			},
		]

		const osm = processRows(rows)

		expect(osm.nodes.size).toBe(4) // 4 unique nodes
		expect(osm.ways.size).toBe(1)
		expect(osm.relations.size).toBe(0)

		const way = osm.ways.getById(-1)
		expect(way).toBeDefined()
		expect(way?.tags?.["building"]).toBe("yes")
		expect(way?.tags?.["name"]).toBe("Test Building")
		expect(way?.tags?.["area"]).toBe("yes")
		expect(way?.refs).toHaveLength(5) // 4 unique + closing
		expect(way?.refs[0]).toBe(way?.refs[4]) // Ring is closed
	})

	it("should convert Polygon with holes to relation with multiple Ways", () => {
		const rows: GeoParquetRow[] = [
			{
				type: "relation",
				id: undefined as unknown as bigint, // Auto-generate IDs
				geometry: createPolygonWkb([
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
				]),
				tags: { building: "yes" },
				bbox: [-122.4194, 37.7749, -122.4094, 37.7849],
			},
		]

		const osm = processRows(rows)

		expect(osm.ways.size).toBe(2)
		expect(osm.relations.size).toBe(1)

		// Get ways by index since IDs are auto-generated
		const outerWay = osm.ways.getByIndex(0)
		expect(outerWay).toBeDefined()
		expect(outerWay?.tags?.["area"]).toBe("yes")
		expect(outerWay?.tags?.["building"]).toBeUndefined() // Tags go on relation

		const holeWay = osm.ways.getByIndex(1)
		expect(holeWay).toBeDefined()
		expect(holeWay?.tags?.["area"]).toBe("yes")

		const relation = osm.relations.getById(-1)
		expect(relation).toBeDefined()
		expect(relation?.tags?.["type"]).toBe("multipolygon")
		expect(relation?.tags?.["building"]).toBe("yes")
		expect(relation?.members).toHaveLength(2)
		expect(relation?.members[0]?.type).toBe("way")
		expect(relation?.members[0]?.role).toBe("outer")
		expect(relation?.members[1]?.type).toBe("way")
		expect(relation?.members[1]?.role).toBe("inner")
	})

	it("should handle JSON string tags", () => {
		const rows: GeoParquetRow[] = [
			{
				type: "node",
				id: undefined as unknown as bigint,
				geometry: createPointWkb(-122.4194, 37.7749),
				tags: '{"name":"Test","highway":"primary"}',
				bbox: [-122.4194, 37.7749, -122.4194, 37.7749],
			},
		]

		const osm = processRows(rows)

		const node = osm.nodes.getById(-1)
		expect(node?.tags?.["name"]).toBe("Test")
		expect(node?.tags?.["highway"]).toBe("primary")
	})

	it("should handle null tags", () => {
		const rows: GeoParquetRow[] = [
			{
				type: "node",
				id: undefined as unknown as bigint,
				geometry: createPointWkb(-122.4194, 37.7749),
				tags: null as unknown as string,
				bbox: [-122.4194, 37.7749, -122.4194, 37.7749],
			},
		]

		const osm = processRows(rows)

		const node = osm.nodes.getById(-1)
		expect(node?.tags).toBeUndefined()
	})

	it("should skip rows with missing geometry", () => {
		const rows: GeoParquetRow[] = [
			{
				type: "node",
				id: undefined as unknown as bigint,
				geometry: undefined as unknown as Uint8Array,
				tags: { name: "Missing geometry" },
				bbox: [0, 0, 0, 0],
			},
			{
				type: "node",
				id: undefined as unknown as bigint,
				geometry: createPointWkb(-122.4194, 37.7749),
				tags: { name: "Valid point" },
				bbox: [-122.4194, 37.7749, -122.4194, 37.7749],
			},
		]

		const osm = processRows(rows)

		expect(osm.nodes.size).toBe(1)
		const node = osm.nodes.getById(-1)
		expect(node?.tags?.["name"]).toBe("Valid point")
	})

	it("should reuse nodes when features share coordinates", () => {
		const rows: GeoParquetRow[] = [
			{
				type: "way",
				id: undefined as unknown as bigint,
				geometry: createLineStringWkb([
					[-122.4194, 37.7749],
					[-122.4094, 37.7849],
				]),
				tags: { highway: "primary" },
				bbox: [-122.4194, 37.7749, -122.4094, 37.7849],
			},
			{
				type: "way",
				id: undefined as unknown as bigint,
				geometry: createLineStringWkb([
					[-122.4094, 37.7849], // Shared coordinate
					[-122.3994, 37.7949],
				]),
				tags: { highway: "secondary" },
				bbox: [-122.4094, 37.7849, -122.3994, 37.7949],
			},
		]

		const osm = processRows(rows)

		// Should have 3 nodes (shared coordinate is reused)
		expect(osm.nodes.size).toBe(3)
		expect(osm.ways.size).toBe(2)

		const way1 = osm.ways.getById(-1)
		const way2 = osm.ways.getById(-2)

		expect(way1?.refs).toHaveLength(2)
		expect(way2?.refs).toHaveLength(2)
		// Shared node
		expect(way1?.refs[1]).toBe(way2?.refs[0])
	})

	it("should build indexes after processing", () => {
		const rows: GeoParquetRow[] = [
			{
				type: "node",
				id: undefined as unknown as bigint,
				geometry: createPointWkb(-122.4194, 37.7749),
				tags: { name: "Test" },
				bbox: [-122.4194, 37.7749, -122.4194, 37.7749],
			},
		]

		const osm = processRows(rows)

		expect(osm.isReady()).toBe(true)
		expect(osm.nodes.isReady()).toBe(true)
		expect(osm.ways.isReady()).toBe(true)
	})

	it("should handle object tags", () => {
		const rows: GeoParquetRow[] = [
			{
				type: "node",
				id: undefined as unknown as bigint,
				geometry: createPointWkb(-122.4194, 37.7749),
				tags: { name: "Test", highway: "primary" },
				bbox: [-122.4194, 37.7749, -122.4194, 37.7749],
			},
		]

		const osm = processRows(rows)

		const node = osm.nodes.getById(-1)
		expect(node?.tags?.["name"]).toBe("Test")
		expect(node?.tags?.["highway"]).toBe("primary")
	})

	it("should handle custom column names", () => {
		const rows = [
			{
				type: "node",
				osm_id: undefined,
				geom: createPointWkb(-122.4194, 37.7749),
				properties: { name: "Custom columns" },
				bbox: [-122.4194, 37.7749, -122.4194, 37.7749],
			},
		] as unknown as GeoParquetRow[]

		const osm = processRows(rows, {
			idColumn: "osm_id",
			geometryColumn: "geom",
			tagsColumn: "properties",
		})

		expect(osm.nodes.size).toBe(1)
		const node = osm.nodes.getById(-1)
		expect(node?.tags?.["name"]).toBe("Custom columns")
	})
})
