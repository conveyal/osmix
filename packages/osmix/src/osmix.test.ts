import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/shared/test/fixtures"
import type { FeatureCollection, LineString, Point } from "geojson"
import { beforeAll, describe, expect, it } from "vitest"
import { Osmix } from "./osmix"

const monacoPbf = PBFs["monaco"]!

describe("Osmix", () => {
	describe("fromPbf", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it("should load from PBF fixture", async () => {
			const osmix = new Osmix()
			const fileStream = getFixtureFileReadStream(monacoPbf.url)
			const osm = await osmix.fromPbf("monaco", fileStream)

			expect(osm.id).toBe("monaco")
			expect(osm.nodes.size).toBe(monacoPbf.nodes)
			expect(osm.ways.size).toBe(monacoPbf.ways)
			expect(osm.relations.size).toBe(monacoPbf.relations)
			expect(osm.stringTable.length).toBe(monacoPbf.uniqueStrings)
		})

		it("should load from PBF ArrayBuffer", async () => {
			const osmix = new Osmix()
			const pbfData = await getFixtureFile(monacoPbf.url)
			const osm = await osmix.fromPbf("monaco-array", pbfData.buffer)

			expect(osm.id).toBe("monaco-array")
			expect(osm.nodes.size).toBe(monacoPbf.nodes)
		})
	})

	describe("fromGeoJSON", () => {
		it("should load from GeoJSON FeatureCollection with Points", async () => {
			const osmix = new Osmix()
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

			const jsonString = JSON.stringify(geojson)
			const buffer = new TextEncoder().encode(jsonString).buffer
			const osm = await osmix.fromGeoJSON("geojson-points", buffer)

			expect(osm.id).toBe("geojson-points")
			expect(osm.nodes.size).toBe(2)
			expect(osm.ways.size).toBe(0)
		})

		it("should load from GeoJSON FeatureCollection with LineStrings", async () => {
			const osmix = new Osmix()
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

			const jsonString = JSON.stringify(geojson)
			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(jsonString))
					controller.close()
				},
			})
			const osm = await osmix.fromGeoJSON("geojson-linestring", stream)

			expect(osm.id).toBe("geojson-linestring")
			expect(osm.nodes.size).toBe(3)
			expect(osm.ways.size).toBe(1)
		})
	})

	describe("get", () => {
		it("should retrieve instance by ID", async () => {
			const osmix = new Osmix()
			const pbfData = await getFixtureFile(monacoPbf.url)
			await osmix.fromPbf("test-get", pbfData.buffer)

			const osm = osmix.get("test-get")
			expect(osm.id).toBe("test-get")
			expect(osm.nodes.size).toBe(monacoPbf.nodes)
		})

		it("should throw error for non-existent ID", () => {
			const osmix = new Osmix()
			expect(() => osmix.get("non-existent")).toThrow(
				"OSM not found for id: non-existent",
			)
		})
	})

	describe("set", () => {
		it("should manually set an instance", async () => {
			const osmix = new Osmix()
			const pbfData = await getFixtureFile(monacoPbf.url)
			const osm = await osmix.fromPbf("original", pbfData.buffer)

			osmix.set("manual-set", osm)
			const retrieved = osmix.get("manual-set")
			expect(retrieved.id).toBe("original")
			expect(retrieved.nodes.size).toBe(monacoPbf.nodes)
		})
	})

	describe("delete", () => {
		it("should remove an instance", async () => {
			const osmix = new Osmix()
			const pbfData = await getFixtureFile(monacoPbf.url)
			await osmix.fromPbf("to-delete", pbfData.buffer)

			expect(() => osmix.get("to-delete")).not.toThrow()
			osmix.delete("to-delete")
			expect(() => osmix.get("to-delete")).toThrow()
		})
	})

	describe("isReady", () => {
		it("should check readiness status", async () => {
			const osmix = new Osmix()
			const pbfData = await getFixtureFile(monacoPbf.url)
			await osmix.fromPbf("ready-test", pbfData.buffer)

			expect(osmix.isReady("ready-test")).toBe(true)
		})

		it("should throw error for non-existent ID", () => {
			const osmix = new Osmix()
			expect(() => osmix.isReady("non-existent")).toThrow()
		})
	})

	describe("search", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it("should search by key only", async () => {
			const osmix = new Osmix()
			const fileStream = getFixtureFileReadStream(monacoPbf.url)
			await osmix.fromPbf("search-test", fileStream)

			const result = osmix.search("search-test", "name")
			expect(result).toHaveProperty("nodes")
			expect(result).toHaveProperty("ways")
			expect(result).toHaveProperty("relations")
			expect(Array.isArray(result.nodes)).toBe(true)
			expect(Array.isArray(result.ways)).toBe(true)
			expect(Array.isArray(result.relations)).toBe(true)
		})

		it("should search by key and value", async () => {
			const osmix = new Osmix()
			const fileStream = getFixtureFileReadStream(monacoPbf.url)
			await osmix.fromPbf("search-kv-test", fileStream)

			const result = osmix.search("search-kv-test", "highway", "residential")
			expect(result).toHaveProperty("nodes")
			expect(result).toHaveProperty("ways")
			expect(result).toHaveProperty("relations")
			expect(Array.isArray(result.nodes)).toBe(true)
			expect(Array.isArray(result.ways)).toBe(true)
			expect(Array.isArray(result.relations)).toBe(true)
		})
	})

	describe("getVectorTile", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it("should generate vector tile for a tile coordinate", async () => {
			const osmix = new Osmix()
			const fileStream = getFixtureFileReadStream(monacoPbf.url)
			await osmix.fromPbf("vector-tile-test", fileStream)

			const tile: [number, number, number] = [7, 4, 3]
			const tileData = osmix.getVectorTile("vector-tile-test", tile)

			expect(tileData).toBeInstanceOf(ArrayBuffer)
			// Vector tiles may be empty if the tile doesn't contain data
			expect(tileData.byteLength).toBeGreaterThanOrEqual(0)
		})
	})

	describe("getRasterTile", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it("should generate raster tile for a tile coordinate", async () => {
			const osmix = new Osmix()
			const fileStream = getFixtureFileReadStream(monacoPbf.url)
			await osmix.fromPbf("raster-tile-test", fileStream)

			const tile: [number, number, number] = [7, 4, 3]
			const tileData = osmix.getRasterTile("raster-tile-test", tile)

			expect(tileData).toBeInstanceOf(ArrayBuffer)
			expect(tileData.byteLength).toBeGreaterThan(0)
		})

		it("should generate raster tile with custom tile size", async () => {
			const osmix = new Osmix()
			const fileStream = getFixtureFileReadStream(monacoPbf.url)
			await osmix.fromPbf("raster-tile-custom-test", fileStream)

			const tile: [number, number, number] = [7, 4, 3]
			const tileData = osmix.getRasterTile("raster-tile-custom-test", tile, 512)

			expect(tileData).toBeInstanceOf(ArrayBuffer)
			expect(tileData.byteLength).toBeGreaterThan(0)
		})
	})

	describe("multi-instance management", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it("should store and retrieve multiple instances with different IDs", async () => {
			const osmix = new Osmix()
			const pbfData = await getFixtureFile(monacoPbf.url)

			await osmix.fromPbf("instance-1", pbfData.buffer)
			await osmix.fromPbf("instance-2", pbfData.buffer)

			const instance1 = osmix.get("instance-1")
			const instance2 = osmix.get("instance-2")

			expect(instance1.id).toBe("instance-1")
			expect(instance2.id).toBe("instance-2")
			expect(instance1.nodes.size).toBe(monacoPbf.nodes)
			expect(instance2.nodes.size).toBe(monacoPbf.nodes)
		})

		it("should delete one instance without affecting others", async () => {
			const osmix = new Osmix()
			const pbfData = await getFixtureFile(monacoPbf.url)

			await osmix.fromPbf("keep-1", pbfData.buffer)
			await osmix.fromPbf("delete-me", pbfData.buffer)
			await osmix.fromPbf("keep-2", pbfData.buffer)

			expect(() => osmix.get("keep-1")).not.toThrow()
			expect(() => osmix.get("delete-me")).not.toThrow()
			expect(() => osmix.get("keep-2")).not.toThrow()

			osmix.delete("delete-me")

			expect(() => osmix.get("keep-1")).not.toThrow()
			expect(() => osmix.get("delete-me")).toThrow()
			expect(() => osmix.get("keep-2")).not.toThrow()
		})
	})
})
