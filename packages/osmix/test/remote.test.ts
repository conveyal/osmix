import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import { Osm } from "@osmix/core"
import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/shared/fixtures"
import type { FeatureCollection, LineString, Point } from "geojson"
import { createRemote } from "../src/remote"

const monacoPbf = PBFs["monaco"]!
// Increase timeout for worker tests
const workerTestTimeout = 30_000

describe("OsmixRemote", () => {
	afterEach(async () => {
		// Clean up workers between tests
		await new Promise((resolve) => setTimeout(resolve, 100))
	})

	describe("fromPbf", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should load from PBF ArrayBuffer via worker",
			async () => {
				using remote = await createRemote({ workerCount: 1 })
				const pbfData = await getFixtureFile(monacoPbf.url)
				const osm = await remote.fromPbf(pbfData.buffer)
				expect(osm.stats.nodes).toBe(monacoPbf.nodes)
			},
			workerTestTimeout,
		)
	})

	describe("fromGeoJSON", () => {
		it(
			"should load from GeoJSON via worker",
			async () => {
				using remote = await createRemote({ workerCount: 1 })
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
				const osm = await remote.fromGeoJSON(buffer)

				expect(osm.stats.nodes).toBe(1)
				expect(osm.stats.ways).toBe(0)
			},
			workerTestTimeout,
		)

		it(
			"should load from GeoJSON ReadableStream via worker",
			async () => {
				using remote = await createRemote({ workerCount: 1 })
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
				const osm = await remote.fromGeoJSON(stream)

				expect(osm.stats.nodes).toBe(2)
				expect(osm.stats.ways).toBe(1)
			},
			workerTestTimeout,
		)
	})

	describe("get", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should retrieve instance from worker",
			async () => {
				using remote = await createRemote({ workerCount: 1 })
				const pbfData = await getFixtureFile(monacoPbf.url)
				const osmInfo = await remote.fromPbf(pbfData.buffer, {
					id: "remote-get",
				})
				const osm = await osmInfo.get()

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
				using remote = await createRemote({ workerCount: 1 })
				const pbfData = await getFixtureFile(monacoPbf.url)
				const osmInfo = await remote.fromPbf(pbfData.buffer, {
					id: "original-remote",
				})
				const osm = await osmInfo.transferOut()
				await remote.transferIn(
					new Osm({ ...osm.transferables(), id: "manual-set-remote" }),
				)
				const retrieved = await remote.get("manual-set-remote")
				expect(retrieved.id).toBe("manual-set-remote")
				expect(retrieved.nodes.size).toBe(monacoPbf.nodes)
				expect(await remote.has("original-remote")).toBe(false)
			},
			workerTestTimeout,
		)
	})

	describe("delete", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should remove instance from worker",
			async () => {
				using remote = await createRemote({ workerCount: 1 })
				const pbfData = await getFixtureFile(monacoPbf.url)
				const osm1 = await remote.fromPbf(pbfData.buffer)

				expect(await osm1.has()).toBe(true)
				await osm1.delete()
				expect(await osm1.has()).toBe(false)
			},
			workerTestTimeout,
		)
	})

	describe("isReady", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should check readiness via worker",
			async () => {
				using remote = await createRemote({ workerCount: 1 })
				const pbfData = await getFixtureFile(monacoPbf.url)
				const osm = await remote.fromPbf(pbfData.buffer)

				expect(await osm.isReady()).toBe(true)
			},
			workerTestTimeout,
		)
	})

	describe("search", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should search via worker",
			async () => {
				using remote = await createRemote({ workerCount: 1 })
				const fileStream = getFixtureFileReadStream(monacoPbf.url)
				const osm = await remote.fromPbf(fileStream)

				const result = await osm.search("name")
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
				using remote = await createRemote({ workerCount: 1 })
				const fileStream = getFixtureFileReadStream(monacoPbf.url)
				const osm = await remote.fromPbf(fileStream)

				const result = await osm.search("highway", "residential")
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
				using remote = await createRemote({ workerCount: 1 })
				const fileStream = getFixtureFileReadStream(monacoPbf.url)
				const osm = await remote.fromPbf(fileStream)

				const tile: [number, number, number] = [7, 4, 3]
				const tileData = await osm.getVectorTile(tile)

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
				using remote = await createRemote({ workerCount: 1 })
				const fileStream = getFixtureFileReadStream(monacoPbf.url)
				const osm = await remote.fromPbf(fileStream)

				const tile: [number, number, number] = [7, 4, 3]
				const tileData = await osm.getRasterTile(tile)

				expect(tileData).toBeInstanceOf(Uint8ClampedArray)
				expect(tileData.byteLength).toBeGreaterThanOrEqual(0)
			},
			workerTestTimeout,
		)

		it(
			"should generate raster tile with custom tile size via worker",
			async () => {
				using remote = await createRemote({ workerCount: 1 })
				const fileStream = getFixtureFileReadStream(monacoPbf.url)
				const osm = await remote.fromPbf(fileStream)

				const tile: [number, number, number] = [7, 4, 3]
				const tileData = await osm.getRasterTile(tile, {
					tileSize: 512,
				})

				expect(tileData).toBeInstanceOf(Uint8ClampedArray)
				expect(tileData.byteLength).toBeGreaterThanOrEqual(0)
			},
			workerTestTimeout,
		)
	})


	describe("dataset handle API", () => {
		it(
			"should expose instance methods without passing IDs",
			async () => {
				using remote = await createRemote({ workerCount: 1 })
				const geojson: FeatureCollection<Point> = {
					type: "FeatureCollection",
					features: [
						{
							type: "Feature",
							geometry: {
								type: "Point",
								coordinates: [-122.4194, 37.7749],
							},
							properties: { amenity: "cafe", name: "Cafe" },
						},
					],
				}

				const data = new TextEncoder().encode(JSON.stringify(geojson)).buffer
				const dataset = await remote.fromGeoJSON(data, { id: "handle-test" })

				expect(dataset.id).toBe("handle-test")
				expect(dataset.stats.nodes).toBe(1)
				expect(await dataset.has()).toBe(true)
				expect(await dataset.isReady()).toBe(true)
				const local = await dataset.get()
				expect(local.id).toBe("handle-test")
			},
			workerTestTimeout,
		)

		it(
			"should return a dataset handle from merge",
			async () => {
				using remote = await createRemote({ workerCount: 1 })
				const point = (name: string, lon: number, lat: number): FeatureCollection<Point> => ({
					type: "FeatureCollection",
					features: [
						{
							type: "Feature",
							geometry: { type: "Point", coordinates: [lon, lat] },
							properties: { name },
						},
					],
				})

				const base = await remote.fromGeoJSON(
					new TextEncoder().encode(JSON.stringify(point("base", -122.4, 37.7))).buffer,
					{ id: "base-osm" },
				)
				const patch = await remote.fromGeoJSON(
					new TextEncoder().encode(JSON.stringify(point("patch", -122.41, 37.71))).buffer,
					{ id: "patch-osm" },
				)

				const merged = await base.merge(patch)
				expect(merged.id).toBe("base-osm")
				expect(merged.stats.nodes).toBeGreaterThanOrEqual(1)
				expect(await remote.has("patch-osm")).toBe(false)
			},
			workerTestTimeout,
		)
	})

	describe("worker pool management", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it(
			"should work with single worker",
			async () => {
				using remote = await createRemote({ workerCount: 1 })
				const pbfData = await getFixtureFile(monacoPbf.url)
				const osm = await remote.fromPbf(pbfData.buffer)
				expect(osm.stats.nodes).toBe(monacoPbf.nodes)
			},
			workerTestTimeout,
		)

		it(
			"should work with multiple workers",
			async () => {
				using remote = await createRemote({ workerCount: 3 })
				const pbfData = await getFixtureFile(monacoPbf.url)

				// Load multiple instances to test round-robin distribution
				const osm1 = await remote.fromPbf(pbfData.buffer.slice(0), {
					id: "multi-worker-1",
				})
				const osm2 = await remote.fromPbf(pbfData.buffer.slice(0), {
					id: "multi-worker-2",
				})
				const osm3 = await remote.fromPbf(pbfData.buffer.slice(0), {
					id: "multi-worker-3",
				})

				expect(osm1.id).toBe("multi-worker-1")
				expect(osm2.id).toBe("multi-worker-2")
				expect(osm3.id).toBe("multi-worker-3")
				expect(osm1.stats.nodes).toBe(monacoPbf.nodes)
				expect(osm2.stats.nodes).toBe(monacoPbf.nodes)
				expect(osm3.stats.nodes).toBe(monacoPbf.nodes)
			},
			workerTestTimeout,
		)
	})
})
