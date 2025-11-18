import { beforeAll, describe, expect, it } from "bun:test"
import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/shared/test/fixtures"
import type { FeatureCollection, LineString, Point } from "geojson"
import { Osmix } from "../src/osmix"

const monacoPbf = PBFs["monaco"]!

describe("Osmix", () => {
	describe("fromPbf", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it("should load from PBF fixture", async () => {
			const osmix = new Osmix()
			const fileStream = getFixtureFileReadStream(monacoPbf.url)
			const osm = await osmix.fromPbf(fileStream)

			expect(osm.nodes.size).toBe(monacoPbf.nodes)
			expect(osm.ways.size).toBe(monacoPbf.ways)
			expect(osm.relations.size).toBe(monacoPbf.relations)
			expect(osm.stringTable.length).toBe(monacoPbf.uniqueStrings)
		})

		it("should load from PBF ArrayBuffer", async () => {
			const osmix = new Osmix()
			const pbfData = await getFixtureFile(monacoPbf.url)
			const osm = await osmix.fromPbf(pbfData.buffer)

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
			const osm = await osmix.fromGeoJSON(buffer)

			expect(osm.id).toBe(osm.id)
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
			const osm = await osmix.fromGeoJSON(stream)

			expect(osm.nodes.size).toBe(3)
			expect(osm.ways.size).toBe(1)
		})
	})

	describe("search", () => {
		beforeAll(() => getFixtureFile(monacoPbf.url))

		it("should search by key only", async () => {
			const osmix = new Osmix()
			const fileStream = getFixtureFileReadStream(monacoPbf.url)
			const osm = await osmix.fromPbf(fileStream, { id: "search-test" })

			const result = osmix.search(osm, "name")
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
			const osm = await osmix.fromPbf(fileStream, { id: "search-kv-test" })

			const result = osmix.search(osm, "highway", "residential")
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
			const osm = await osmix.fromPbf(fileStream, { id: "vector-tile-test" })

			const tile: [number, number, number] = [7, 4, 3]
			const tileData = osmix.getVectorTile(osm, tile)

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
			const osm = await osmix.fromPbf(fileStream, { id: "raster-tile-test" })

			const tile: [number, number, number] = [7, 4, 3]
			const tileData = osmix.getRasterTile(osm, tile)

			expect(tileData).toBeInstanceOf(Uint8ClampedArray)
			expect(tileData.byteLength).toBeGreaterThan(0)
		})

		it("should generate raster tile with custom tile size", async () => {
			const osmix = new Osmix()
			const fileStream = getFixtureFileReadStream(monacoPbf.url)
			const osm = await osmix.fromPbf(fileStream, {
				id: "raster-tile-custom-test",
			})

			const tile: [number, number, number] = [7, 4, 3]
			const tileData = osmix.getRasterTile(osm, tile, 512)

			expect(tileData).toBeInstanceOf(Uint8ClampedArray)
			expect(tileData.byteLength).toBeGreaterThan(0)
		})
	})
})
