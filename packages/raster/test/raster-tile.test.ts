import SphericalMercatorTile from "@osmix/shared/spherical-mercator"
import type { LonLat, Tile, XY } from "@osmix/shared/types"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_NODE_COLOR,
	DEFAULT_RASTER_TILE_SIZE,
	DEFAULT_WAY_COLOR,
	OsmixRasterTile,
} from "../src/raster-tile"

function createTile(
	tileIndex: Tile = [4, 5, 3],
	tileSize = DEFAULT_RASTER_TILE_SIZE,
) {
	const merc = new SphericalMercatorTile({ size: tileSize })
	return {
		tile: new OsmixRasterTile(tileIndex, tileSize),
		merc,
	}
}

function lonLatForPixel(
	merc: SphericalMercatorTile,
	tileIndex: Tile,
	tileSize: number,
	px: number,
	py: number,
): [number, number] {
	const [x, y, z] = tileIndex
	return merc.ll([x * tileSize + px, y * tileSize + py], z) as [number, number]
}

describe("OsmixRasterTile", () => {
	it("sets point pixels using lon/lat coordinates", () => {
		const tileIndex: Tile = [6, 7, 4]
		const tileSize = DEFAULT_RASTER_TILE_SIZE
		const { tile, merc } = createTile(tileIndex, tileSize)
		const nodePixel = [12, 20] as const
		const nodeLonLat = lonLatForPixel(
			merc,
			tileIndex,
			tileSize,
			nodePixel[0],
			nodePixel[1],
		)

		tile.setLonLat(nodeLonLat)

		const idx = (nodePixel[1] * tileSize + nodePixel[0]) * 4
		expect(Array.from(tile.imageData.slice(idx, idx + 4))).toEqual(
			Array.from(DEFAULT_NODE_COLOR),
		)
	})

	it("draws clipped ways using Bresenham line rendering", () => {
		const tileIndex: Tile = [10, 11, 5]
		const tileSize = DEFAULT_RASTER_TILE_SIZE
		const [tx, ty, tz] = tileIndex
		const { tile, merc } = createTile(tileIndex)

		const startPixel: XY = [5, 5]
		const endPixel: XY = [40, 36]

		const way = [
			lonLatForPixel(merc, tileIndex, tileSize, startPixel[0], startPixel[1]),
			lonLatForPixel(merc, tileIndex, tileSize, endPixel[0], endPixel[1]),
		]

		// Prefix and suffix points outside the tile bounds to exercise clipping.
		const outsidePrefix: LonLat = merc.ll(
			[tx * tileSize - 20, ty * tileSize - 20],
			tz,
		)
		const outsideSuffix: LonLat = merc.ll(
			[(tx + 1) * tileSize + 20, (ty + 1) * tileSize + 20],
			tz,
		)

		tile.drawWay([outsidePrefix, ...way, outsideSuffix])

		const startIdx = tile.getIndex(startPixel)
		const endIdx = tile.getIndex(endPixel)
		expect(Array.from(tile.imageData.slice(startIdx, startIdx + 4))).toEqual(
			Array.from(DEFAULT_WAY_COLOR),
		)
		expect(Array.from(tile.imageData.slice(endIdx, endIdx + 4))).toEqual(
			Array.from(DEFAULT_WAY_COLOR),
		)
	})

	it("fills polygons using scanline algorithm", () => {
		const tileIndex: Tile = [10, 11, 5]
		const tileSize = DEFAULT_RASTER_TILE_SIZE
		const { tile, merc } = createTile(tileIndex, tileSize)

		// Create a simple square polygon
		const polygon: LonLat[][] = [
			[
				lonLatForPixel(merc, tileIndex, tileSize, 10, 10),
				lonLatForPixel(merc, tileIndex, tileSize, 30, 10),
				lonLatForPixel(merc, tileIndex, tileSize, 30, 30),
				lonLatForPixel(merc, tileIndex, tileSize, 10, 30),
				lonLatForPixel(merc, tileIndex, tileSize, 10, 10), // Closed
			],
		]

		tile.drawPolygon(polygon)

		// Check that pixels inside the polygon are filled
		const centerIdx = tile.getIndex([20, 20])
		expect(Array.from(tile.imageData.slice(centerIdx, centerIdx + 4))).toEqual(
			Array.from(DEFAULT_WAY_COLOR),
		)

		// Check that pixels outside are not filled (assuming initial state is transparent/black)
		const outsideIdx = tile.getIndex([5, 5])
		expect(Array.from(tile.imageData.slice(outsideIdx, outsideIdx + 4))).toEqual([
			0, 0, 0, 0,
		])
	})

	it("fills polygons with holes correctly", () => {
		const tileIndex: Tile = [10, 11, 5]
		const tileSize = DEFAULT_RASTER_TILE_SIZE
		const { tile, merc } = createTile(tileIndex, tileSize)

		// Create a polygon with a hole
		const polygon: LonLat[][] = [
			// Outer ring
			[
				lonLatForPixel(merc, tileIndex, tileSize, 10, 10),
				lonLatForPixel(merc, tileIndex, tileSize, 50, 10),
				lonLatForPixel(merc, tileIndex, tileSize, 50, 50),
				lonLatForPixel(merc, tileIndex, tileSize, 10, 50),
				lonLatForPixel(merc, tileIndex, tileSize, 10, 10),
			],
			// Hole
			[
				lonLatForPixel(merc, tileIndex, tileSize, 25, 25),
				lonLatForPixel(merc, tileIndex, tileSize, 35, 25),
				lonLatForPixel(merc, tileIndex, tileSize, 35, 35),
				lonLatForPixel(merc, tileIndex, tileSize, 25, 35),
				lonLatForPixel(merc, tileIndex, tileSize, 25, 25),
			],
		]

		tile.drawPolygon(polygon)

		// Check that pixels inside outer ring but outside hole are filled
		const insideOuterIdx = tile.getIndex([15, 15])
		expect(
			Array.from(tile.imageData.slice(insideOuterIdx, insideOuterIdx + 4)),
		).toEqual(Array.from(DEFAULT_WAY_COLOR))

		// Check that pixels inside the hole are NOT filled (even-odd rule)
		const insideHoleIdx = tile.getIndex([30, 30])
		expect(Array.from(tile.imageData.slice(insideHoleIdx, insideHoleIdx + 4))).toEqual(
			[0, 0, 0, 0],
		)
	})

	it("draws MultiPolygons correctly", () => {
		const tileIndex: Tile = [10, 11, 5]
		const tileSize = DEFAULT_RASTER_TILE_SIZE
		const { tile, merc } = createTile(tileIndex, tileSize)

		// Create a MultiPolygon with two separate polygons
		const multiPolygon: LonLat[][][] = [
			// First polygon
			[
				[
					lonLatForPixel(merc, tileIndex, tileSize, 10, 10),
					lonLatForPixel(merc, tileIndex, tileSize, 20, 10),
					lonLatForPixel(merc, tileIndex, tileSize, 20, 20),
					lonLatForPixel(merc, tileIndex, tileSize, 10, 20),
					lonLatForPixel(merc, tileIndex, tileSize, 10, 10),
				],
			],
			// Second polygon
			[
				[
					lonLatForPixel(merc, tileIndex, tileSize, 30, 30),
					lonLatForPixel(merc, tileIndex, tileSize, 40, 30),
					lonLatForPixel(merc, tileIndex, tileSize, 40, 40),
					lonLatForPixel(merc, tileIndex, tileSize, 30, 40),
					lonLatForPixel(merc, tileIndex, tileSize, 30, 30),
				],
			],
		]

		tile.drawMultiPolygon(multiPolygon)

		// Check that both polygons are filled
		const firstPolyIdx = tile.getIndex([15, 15])
		expect(Array.from(tile.imageData.slice(firstPolyIdx, firstPolyIdx + 4))).toEqual(
			Array.from(DEFAULT_WAY_COLOR),
		)

		const secondPolyIdx = tile.getIndex([35, 35])
		expect(Array.from(tile.imageData.slice(secondPolyIdx, secondPolyIdx + 4))).toEqual(
			Array.from(DEFAULT_WAY_COLOR),
		)
	})

	it("handles empty polygon rings gracefully", () => {
		const tileIndex: Tile = [10, 11, 5]
		const { tile } = createTile(tileIndex)

		// Should not throw
		tile.drawPolygon([])
		expect(tile.imageData.every((v) => v === 0)).toBe(true)
	})
})
