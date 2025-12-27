import { describe, expect, it } from "bun:test"
import { getFixturePath } from "@osmix/shared/test/fixtures"
import { fromGeoParquet, GeoParquetOsmBuilder } from "../src"

/**
 * Integration tests using the Monaco highways GeoParquet fixture.
 *
 * The fixture was downloaded from LayerCake (https://openstreetmap.us/our-work/layercake/)
 * using DuckDB with a bounding box filter for Monaco. The fixture has a flattened
 * structure where each tag column is separate (highway, name, surface, etc.) rather
 * than nested in a tags struct.
 *
 * Note: hyparquet automatically parses GeoParquet WKB geometry into GeoJSON objects.
 *
 * Monaco bounding box:
 * - xmin: 7.409205, xmax: 7.448637
 * - ymin: 43.72335, ymax: 43.75169
 */

describe("@osmix/layercake: Monaco highways fixture", () => {
	const fixtureFile = () => Bun.file(getFixturePath("monaco.parquet"))
	const getOsm = async () => fromGeoParquet(await fixtureFile().arrayBuffer())

	it("should load the monaco.parquet fixture", async () => {
		const file = fixtureFile()
		expect(await file.exists()).toBe(true)

		const size = file.size
		expect(size).toBeGreaterThan(0)
		expect(size).toBeLessThan(1_000_000) // Should be a small fixture
	})

	it("should read parquet rows with correct structure", async () => {
		const builder = new GeoParquetOsmBuilder({ id: "monaco" }, { rowEnd: 5 })
		const rows = await builder.readParquetRows(
			await fixtureFile().arrayBuffer(),
		)

		expect(rows.length).toBe(5)

		// Verify row structure
		const firstRow = rows[0]!
		expect(firstRow["id"]).toBeDefined()
		expect(firstRow["geometry"]).toBeDefined()
		// expect(firstRow.osm_type).toBeDefined()

		// hyparquet parses GeoParquet WKB into GeoJSON automatically
		expect(firstRow["geometry"].type).toBeDefined()
		// Verify it's a geometry with coordinates (not a GeometryCollection)
		expect(["Point", "LineString", "Polygon", "MultiPolygon"]).toContain(
			firstRow["geometry"].type,
		)
	})

	it("should convert highway features to OSM entities", async () => {
		const osm = await getOsm()

		// Should have created nodes and ways from the highway features
		expect(osm.nodes.size).toBeGreaterThan(0)
		expect(osm.ways.size).toBeGreaterThan(0)

		// Monaco is small, so we expect reasonable numbers
		// The highway extract should have a few hundred to a few thousand ways
		expect(osm.ways.size).toBeGreaterThan(100)
		expect(osm.ways.size).toBeLessThan(10_000)
	})

	it("should preserve highway tags from LayerCake columns", async () => {
		const osm = await getOsm()

		// Find ways with highway tags
		let highwayCount = 0
		for (let i = 0; i < osm.ways.size; i++) {
			const way = osm.ways.getByIndex(i)
			if (way?.tags?.["highway"]) {
				highwayCount++
			}
		}

		// Most features should have highway tags since this is the highways layer
		expect(highwayCount).toBeGreaterThan(0)
	})

	it("should have valid node coordinates within Monaco bounds", async () => {
		const osm = await getOsm()

		// Monaco bounding box (slightly expanded for node positions)
		const minLon = 7.4
		const maxLon = 7.45
		const minLat = 43.72
		const maxLat = 43.76

		// Check that all nodes are within Monaco bounds
		let validNodes = 0
		for (let i = 0; i < osm.nodes.size; i++) {
			const node = osm.nodes.getByIndex(i)
			if (node) {
				expect(node.lon).toBeGreaterThanOrEqual(minLon)
				expect(node.lon).toBeLessThanOrEqual(maxLon)
				expect(node.lat).toBeGreaterThanOrEqual(minLat)
				expect(node.lat).toBeLessThanOrEqual(maxLat)
				validNodes++
			}
		}

		expect(validNodes).toBeGreaterThan(0)
	})

	it("should build spatial indexes after loading", async () => {
		const osm = await getOsm()

		// Indexes should be built
		expect(osm.isReady()).toBe(true)
		expect(osm.nodes.isReady()).toBe(true)
		expect(osm.ways.isReady()).toBe(true)
	})

	it("should handle ways with multiple nodes", async () => {
		const osm = await getOsm()
		// Count ways with enough nodes
		let validWays = 0
		for (let i = 0; i < osm.ways.size; i++) {
			const way = osm.ways.getByIndex(i)
			if (way && way.refs.length >= 2) {
				validWays++
				// All node refs should resolve to actual nodes
				for (const ref of way.refs) {
					const node = osm.nodes.getById(ref)
					expect(node).toBeDefined()
				}
			}
		}

		// Most ways should have at least 2 nodes (minimum for a LineString)
		expect(validWays).toBeGreaterThan(0)
	})

	it("should handle maxRows option to limit features", async () => {
		const builder = new GeoParquetOsmBuilder({ id: "monaco" }, { rowEnd: 10 })
		const rows = await builder.readParquetRows(
			await fixtureFile().arrayBuffer(),
		)
		builder.processGeoParquetRows(rows)
		const osm = builder.buildOsm()

		// Should only have processed 10 features
		expect(rows.length).toBe(10)
		// Note: Some rows may be Point geometries (crossings) which don't create ways
		expect(osm.nodes.size + osm.ways.size).toBeGreaterThan(0)
	})

	it("should find common highway types in Monaco", async () => {
		const osm = await getOsm()

		const highwayTypes = new Map<string, number>()

		for (let i = 0; i < osm.ways.size; i++) {
			const way = osm.ways.getByIndex(i)
			const highway = way?.tags?.["highway"]
			if (highway && typeof highway === "string") {
				highwayTypes.set(highway, (highwayTypes.get(highway) ?? 0) + 1)
			}
		}

		// Monaco should have some common highway types
		const allTypes = Array.from(highwayTypes.keys())
		expect(allTypes.length).toBeGreaterThan(0)

		// Common types that should exist in Monaco's dense urban area
		const commonTypes = ["residential", "footway", "service", "path", "steps"]
		const foundCommonTypes = commonTypes.filter((t) => highwayTypes.has(t))

		// At least some common types should be present
		expect(foundCommonTypes.length).toBeGreaterThan(0)
	})

	it("should handle surface and other highway attributes", async () => {
		const osm = await getOsm()

		// Check that some ways have additional attributes beyond just highway
		let waysWithSurface = 0
		let waysWithName = 0

		for (let i = 0; i < osm.ways.size; i++) {
			const way = osm.ways.getByIndex(i)
			if (way?.tags) {
				if (way.tags["surface"]) waysWithSurface++
				if (way.tags["name"]) waysWithName++
			}
		}

		// Some highways should have surface or name attributes
		// (not all will, so we just check that at least some do)
		expect(waysWithSurface + waysWithName).toBeGreaterThan(0)
	})

	it("should reuse nodes for connected highways", async () => {
		const osm = await getOsm()

		// Count how many ways reference the same nodes
		const nodeRefCounts = new Map<number, number>()

		for (let i = 0; i < osm.ways.size; i++) {
			const way = osm.ways.getByIndex(i)
			if (way) {
				for (const ref of way.refs) {
					nodeRefCounts.set(ref, (nodeRefCounts.get(ref) ?? 0) + 1)
				}
			}
		}

		// Some nodes should be shared between multiple ways (intersections)
		const sharedNodes = Array.from(nodeRefCounts.values()).filter((c) => c > 1)
		expect(sharedNodes.length).toBeGreaterThan(0)
	})

	it("should handle Point geometries (crossings)", async () => {
		const osm = await getOsm()

		// Find nodes with crossing tags (Point features become Nodes with tags)
		let crossingCount = 0
		for (let i = 0; i < osm.nodes.size; i++) {
			const node = osm.nodes.getByIndex(i)
			if (node?.tags?.["highway"] === "crossing") {
				crossingCount++
			}
		}

		// Monaco should have some pedestrian crossings
		expect(crossingCount).toBeGreaterThan(0)
	})

	it("should count geometry types in the fixture", async () => {
		const builder = new GeoParquetOsmBuilder({ id: "monaco" })
		const rows = await builder.readParquetRows(
			await fixtureFile().arrayBuffer(),
		)

		const typeCounts = new Map<string, number>()
		for (const row of rows) {
			const type = row["geometry"]?.type ?? "unknown"
			typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1)
		}

		// Highways layer should have mostly LineStrings (roads) and some Points (crossings)
		expect(typeCounts.get("LineString") ?? 0).toBeGreaterThan(0)
		expect(typeCounts.get("Point") ?? 0).toBeGreaterThan(0)
	})
})
