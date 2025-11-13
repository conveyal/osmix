import {
	getFixtureFile,
	getFixtureFileReadStream,
	getFixturePath,
	PBFs,
} from "@osmix/shared/test/fixtures"
import type { FeatureCollection, LineString, Point } from "geojson"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { OsmixRemote } from "./remote"

const monacoPbf = PBFs["monaco"]!

describe("OsmixComlinkTest", () => {
	beforeAll(() => getFixtureFile(monacoPbf.url))

	it("should load from PBF fixture via worker", async () => {
		const remote = await OsmixRemote.connect()
		const fileStream = await Bun.file(
			getFixturePath(monacoPbf.url),
		).arrayBuffer()
		const osm = await remote.fromPbf("monaco-remote", fileStream)
		expect(osm.id).toBe("monaco-remote")
		expect(osm.nodes.size).toBe(monacoPbf.nodes)
	})
})

describe.skip("OsmixRemote", () => {
	afterEach(async () => {
		// Clean up workers between tests
		await new Promise((resolve) => setTimeout(resolve, 100))
	})

	// Increase timeout for worker tests
	const workerTestTimeout = 30_000

	describe("fromPbf", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should load from PBF fixture via worker",
			async () => {
				const remote = new OsmixRemote(1)
				const fileStream = getFixtureFileReadStream(monacoPbf.url)
				const osm = await remote.fromPbf("monaco-remote", fileStream, {})

				expect(osm.id).toBe("monaco-remote")
				expect(osm.nodes.size).toBe(monacoPbf.nodes)
				expect(osm.ways.size).toBe(monacoPbf.ways)
				expect(osm.relations.size).toBe(monacoPbf.relations)
			},
			workerTestTimeout,
		)

		it(
			"should load from PBF ArrayBuffer via worker",
			async () => {
				const remote = new OsmixRemote(1)
				const pbfData = await getFixtureFile(monacoPbf.url)
				const osm = await remote.fromPbf(
					"monaco-remote-array",
					pbfData.buffer,
					{},
				)

				expect(osm.id).toBe("monaco-remote-array")
				expect(osm.nodes.size).toBe(monacoPbf.nodes)
			},
			workerTestTimeout,
		)
	})

	describe("fromGeoJSON", () => {
		it(
			"should load from GeoJSON via worker",
			async () => {
				const remote = new OsmixRemote(1)
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
								amenity: "cafe",
							},
						},
					],
				}

				const jsonString = JSON.stringify(geojson)
				const buffer = new TextEncoder().encode(jsonString).buffer
				const osm = await remote.fromGeoJSON("geojson-remote", buffer, {})

				expect(osm.id).toBe("geojson-remote")
				expect(osm.nodes.size).toBe(1)
				expect(osm.ways.size).toBe(0)
			},
			workerTestTimeout,
		)

		it(
			"should load from GeoJSON ReadableStream via worker",
			async () => {
				const remote = new OsmixRemote(1)
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
					],
				}

				const jsonString = JSON.stringify(geojson)
				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(jsonString))
						controller.close()
					},
				})
				const osm = await remote.fromGeoJSON(
					"geojson-remote-stream",
					stream,
					{},
				)

				expect(osm.id).toBe("geojson-remote-stream")
				expect(osm.nodes.size).toBe(2)
				expect(osm.ways.size).toBe(1)
			},
			workerTestTimeout,
		)
	})

	describe("get", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should retrieve instance from worker",
			async () => {
				const remote = new OsmixRemote(1)
				const pbfData = await getFixtureFile(monacoPbf.url)
				await remote.fromPbf("remote-get", pbfData.buffer, {})

				const osm = await remote.get("remote-get")
				expect(osm.id).toBe("remote-get")
				expect(osm.nodes.size).toBe(monacoPbf.nodes)
			},
			workerTestTimeout,
		)
	})

	describe("set", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should set instance in worker",
			async () => {
				const remote = new OsmixRemote(1)
				const pbfData = await getFixtureFile(monacoPbf.url)
				const osm = await remote.fromPbf("original-remote", pbfData.buffer, {})

				await remote.set("manual-set-remote", osm)
				const retrieved = await remote.get("manual-set-remote")
				expect(retrieved.id).toBe("original-remote")
				expect(retrieved.nodes.size).toBe(monacoPbf.nodes)
			},
			workerTestTimeout,
		)
	})

	describe("delete", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should remove instance from worker",
			async () => {
				const remote = new OsmixRemote(1)
				const pbfData = await getFixtureFile(monacoPbf.url)
				await remote.fromPbf("to-delete-remote", pbfData.buffer, {})

				const osm = await remote.get("to-delete-remote")
				expect(osm).toBeDefined()

				await remote.delete("to-delete-remote")
				// Note: get() will still work but may return empty data
				// The actual behavior depends on worker implementation
			},
			workerTestTimeout,
		)
	})

	describe("isReady", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should check readiness via worker",
			async () => {
				const remote = new OsmixRemote(1)
				const pbfData = await getFixtureFile(monacoPbf.url)
				await remote.fromPbf("ready-remote", pbfData.buffer, {})

				const isReady = await remote.isReady("ready-remote")
				expect(typeof isReady).toBe("boolean")
			},
			workerTestTimeout,
		)
	})

	describe("search", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should search via worker",
			async () => {
				const remote = new OsmixRemote(1)
				const fileStream = getFixtureFileReadStream(monacoPbf.url)
				await remote.fromPbf("search-remote", fileStream, {})

				const result = await remote.search("search-remote", "name")
				expect(result).toHaveProperty("nodes")
				expect(result).toHaveProperty("ways")
				expect(result).toHaveProperty("relations")
				expect(Array.isArray(result.nodes)).toBe(true)
				expect(Array.isArray(result.ways)).toBe(true)
				expect(Array.isArray(result.relations)).toBe(true)
			},
			workerTestTimeout,
		)

		it(
			"should search by key and value via worker",
			async () => {
				const remote = new OsmixRemote(1)
				const fileStream = getFixtureFileReadStream(monacoPbf.url)
				await remote.fromPbf("search-kv-remote", fileStream, {})

				const result = await remote.search(
					"search-kv-remote",
					"highway",
					"residential",
				)
				expect(result).toHaveProperty("nodes")
				expect(result).toHaveProperty("ways")
				expect(result).toHaveProperty("relations")
			},
			workerTestTimeout,
		)
	})

	describe("getVectorTile", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should generate vector tile via worker",
			async () => {
				const remote = new OsmixRemote(1)
				const fileStream = getFixtureFileReadStream(monacoPbf.url)
				await remote.fromPbf("vector-tile-remote", fileStream, {})

				const tile: [number, number, number] = [7, 4, 3]
				const tileData = await remote.getVectorTile("vector-tile-remote", tile)

				expect(tileData).toBeInstanceOf(ArrayBuffer)
				expect(tileData.byteLength).toBeGreaterThanOrEqual(0)
			},
			workerTestTimeout,
		)
	})

	describe("getRasterTile", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should generate raster tile via worker",
			async () => {
				const remote = new OsmixRemote(1)
				const fileStream = getFixtureFileReadStream(monacoPbf.url)
				await remote.fromPbf("raster-tile-remote", fileStream, {})

				const tile: [number, number, number] = [7, 4, 3]
				const tileData = await remote.getRasterTile("raster-tile-remote", tile)

				expect(tileData).toBeInstanceOf(ArrayBuffer)
				expect(tileData.byteLength).toBeGreaterThanOrEqual(0)
			},
			workerTestTimeout,
		)

		it(
			"should generate raster tile with custom tile size via worker",
			async () => {
				const remote = new OsmixRemote(1)
				const fileStream = getFixtureFileReadStream(monacoPbf.url)
				await remote.fromPbf("raster-tile-custom-remote", fileStream, {})

				const tile: [number, number, number] = [7, 4, 3]
				const tileData = await remote.getRasterTile(
					"raster-tile-custom-remote",
					tile,
					512,
				)

				expect(tileData).toBeInstanceOf(ArrayBuffer)
				expect(tileData.byteLength).toBeGreaterThanOrEqual(0)
			},
			workerTestTimeout,
		)
	})

	describe("worker pool management", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should work with single worker",
			async () => {
				const remote = new OsmixRemote(1)
				const pbfData = await getFixtureFile(monacoPbf.url)
				const osm = await remote.fromPbf("single-worker", pbfData.buffer, {})

				expect(osm.id).toBe("single-worker")
				expect(osm.nodes.size).toBe(monacoPbf.nodes)
			},
			workerTestTimeout,
		)

		it(
			"should work with multiple workers",
			async () => {
				const remote = new OsmixRemote(3)
				const pbfData = await getFixtureFile(monacoPbf.url)

				// Load multiple instances to test round-robin distribution
				const osm1 = await remote.fromPbf("multi-worker-1", pbfData.buffer, {})
				const osm2 = await remote.fromPbf("multi-worker-2", pbfData.buffer, {})
				const osm3 = await remote.fromPbf("multi-worker-3", pbfData.buffer, {})

				expect(osm1.id).toBe("multi-worker-1")
				expect(osm2.id).toBe("multi-worker-2")
				expect(osm3.id).toBe("multi-worker-3")
				expect(osm1.nodes.size).toBe(monacoPbf.nodes)
				expect(osm2.nodes.size).toBe(monacoPbf.nodes)
				expect(osm3.nodes.size).toBe(monacoPbf.nodes)
			},
			workerTestTimeout,
		)
	})
})
