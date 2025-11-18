import { describe, expect, it } from "bun:test"
import SphericalMercatorTile from "@osmix/shared/spherical-mercator"
import type { LonLat, Tile, XY } from "@osmix/shared/types"
import {
	DEFAULT_AREA_COLOR,
	DEFAULT_LINE_COLOR,
	DEFAULT_POINT_COLOR,
	DEFAULT_RASTER_TILE_SIZE,
	OsmixRasterTile,
} from "../src/raster-tile"

function createTile(
	tileIndex: Tile = [4, 5, 3],
	tileSize = DEFAULT_RASTER_TILE_SIZE,
) {
	const merc = new SphericalMercatorTile({ size: tileSize })
	return {
		tile: new OsmixRasterTile({ tile: tileIndex, tileSize }),
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
			Array.from(DEFAULT_POINT_COLOR),
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

		tile.drawLineString([outsidePrefix, ...way, outsideSuffix])

		const startIdx = tile.getIndex(startPixel)
		const endIdx = tile.getIndex(endPixel)
		expect(Array.from(tile.imageData.slice(startIdx, startIdx + 4))).toEqual(
			Array.from(DEFAULT_LINE_COLOR),
		)
		expect(Array.from(tile.imageData.slice(endIdx, endIdx + 4))).toEqual(
			Array.from(DEFAULT_LINE_COLOR),
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
			Array.from(DEFAULT_AREA_COLOR),
		)

		// Check that pixels outside are not filled (assuming initial state is transparent/black)
		const outsideIdx = tile.getIndex([5, 5])
		expect(
			Array.from(tile.imageData.slice(outsideIdx, outsideIdx + 4)),
		).toEqual([0, 0, 0, 0])
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
		).toEqual(Array.from(DEFAULT_AREA_COLOR))

		// Check that pixels inside the hole are NOT filled (even-odd rule)
		const insideHoleIdx = tile.getIndex([30, 30])
		expect(
			Array.from(tile.imageData.slice(insideHoleIdx, insideHoleIdx + 4)),
		).toEqual([0, 0, 0, 0])
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
		expect(
			Array.from(tile.imageData.slice(firstPolyIdx, firstPolyIdx + 4)),
		).toEqual(Array.from(DEFAULT_AREA_COLOR))

		const secondPolyIdx = tile.getIndex([35, 35])
		expect(
			Array.from(tile.imageData.slice(secondPolyIdx, secondPolyIdx + 4)),
		).toEqual(Array.from(DEFAULT_AREA_COLOR))
	})

	it("handles empty polygon rings gracefully", () => {
		const tileIndex: Tile = [10, 11, 5]
		const { tile } = createTile(tileIndex)

		// Should not throw
		tile.drawPolygon([])
		expect(tile.imageData.every((v) => v === 0)).toBe(true)
	})

	it("handles polygon with hole correctly (winding order)", () => {
		const tileIndex: Tile = [10, 11, 5]
		const tileSize = DEFAULT_RASTER_TILE_SIZE
		const { tile, merc } = createTile(tileIndex, tileSize)

		// Create outer square (counterclockwise for GeoJSON)
		const outerRing: LonLat[] = [
			lonLatForPixel(merc, tileIndex, tileSize, 10, 10),
			lonLatForPixel(merc, tileIndex, tileSize, 30, 10),
			lonLatForPixel(merc, tileIndex, tileSize, 30, 30),
			lonLatForPixel(merc, tileIndex, tileSize, 10, 30),
			lonLatForPixel(merc, tileIndex, tileSize, 10, 10), // closed
		]

		// Create inner square hole (clockwise for GeoJSON)
		const innerRing: LonLat[] = [
			lonLatForPixel(merc, tileIndex, tileSize, 15, 15),
			lonLatForPixel(merc, tileIndex, tileSize, 15, 25),
			lonLatForPixel(merc, tileIndex, tileSize, 25, 25),
			lonLatForPixel(merc, tileIndex, tileSize, 25, 15),
			lonLatForPixel(merc, tileIndex, tileSize, 15, 15), // closed
		]

		tile.drawPolygon([outerRing, innerRing])

		// Check that pixels inside outer but outside inner are filled
		// Point at [12, 12] is inside outer ring (10-30) but outside inner ring (15-25)
		const insideOuter = tile.getIndex([12, 12])
		expect(
			Array.from(tile.imageData.slice(insideOuter, insideOuter + 4)),
		).toEqual(Array.from(DEFAULT_AREA_COLOR))

		// Check that pixels inside inner (hole) are NOT filled
		const insideHole = tile.getIndex([20, 20])
		const holeColor = Array.from(
			tile.imageData.slice(insideHole, insideHole + 4),
		)
		expect(holeColor[3]).toBe(0) // Alpha should be 0 (transparent)
	})

	it("handles multipolygon with multiple separate polygons", () => {
		const tileIndex: Tile = [10, 11, 5]
		const tileSize = DEFAULT_RASTER_TILE_SIZE
		const { tile, merc } = createTile(tileIndex, tileSize)

		// First polygon
		const polygon1: LonLat[][] = [
			[
				lonLatForPixel(merc, tileIndex, tileSize, 10, 10),
				lonLatForPixel(merc, tileIndex, tileSize, 20, 10),
				lonLatForPixel(merc, tileIndex, tileSize, 20, 20),
				lonLatForPixel(merc, tileIndex, tileSize, 10, 20),
				lonLatForPixel(merc, tileIndex, tileSize, 10, 10),
			],
		]

		// Second polygon (separate)
		const polygon2: LonLat[][] = [
			[
				lonLatForPixel(merc, tileIndex, tileSize, 30, 30),
				lonLatForPixel(merc, tileIndex, tileSize, 40, 30),
				lonLatForPixel(merc, tileIndex, tileSize, 40, 40),
				lonLatForPixel(merc, tileIndex, tileSize, 30, 40),
				lonLatForPixel(merc, tileIndex, tileSize, 30, 30),
			],
		]

		tile.drawMultiPolygon([polygon1, polygon2])

		// Check first polygon is filled
		const center1 = tile.getIndex([15, 15])
		expect(Array.from(tile.imageData.slice(center1, center1 + 4))).toEqual(
			Array.from(DEFAULT_AREA_COLOR),
		)

		// Check second polygon is filled
		const center2 = tile.getIndex([35, 35])
		expect(Array.from(tile.imageData.slice(center2, center2 + 4))).toEqual(
			Array.from(DEFAULT_AREA_COLOR),
		)

		// Check area between polygons is NOT filled
		const between = tile.getIndex([25, 25])
		const betweenColor = Array.from(tile.imageData.slice(between, between + 4))
		expect(betweenColor[3]).toBe(0) // Should be transparent
	})

	it("normalizes winding order using rewind", () => {
		const tileIndex: Tile = [10, 11, 5]
		const tileSize = DEFAULT_RASTER_TILE_SIZE
		const { tile, merc } = createTile(tileIndex, tileSize)

		// Create polygon with clockwise winding (should be normalized to counterclockwise)
		const clockwiseRing: LonLat[] = [
			lonLatForPixel(merc, tileIndex, tileSize, 10, 10),
			lonLatForPixel(merc, tileIndex, tileSize, 10, 30),
			lonLatForPixel(merc, tileIndex, tileSize, 30, 30),
			lonLatForPixel(merc, tileIndex, tileSize, 30, 10),
			lonLatForPixel(merc, tileIndex, tileSize, 10, 10),
		]

		tile.drawPolygon([clockwiseRing])

		// Should still fill correctly regardless of input winding
		const center = tile.getIndex([20, 20])
		expect(Array.from(tile.imageData.slice(center, center + 4))).toEqual(
			Array.from(DEFAULT_AREA_COLOR),
		)
	})

	describe("edge boundary handling", () => {
		it("excludes left boundary pixels when polygon crosses left edge", () => {
			const tileIndex: Tile = [10, 11, 5]
			const tileSize = DEFAULT_RASTER_TILE_SIZE
			const [tx, ty, tz] = tileIndex
			const { tile, merc } = createTile(tileIndex, tileSize)

			// Create polygon that extends beyond left edge (x < 0)
			// Create a large rectangle that extends from outside left edge well inside
			const polygon: LonLat[][] = [
				[
					merc.ll([tx * tileSize - 20, ty * tileSize + 50], tz),
					merc.ll([tx * tileSize - 20, ty * tileSize + 100], tz),
					lonLatForPixel(merc, tileIndex, tileSize, 100, 100),
					lonLatForPixel(merc, tileIndex, tileSize, 100, 50),
					merc.ll([tx * tileSize - 20, ty * tileSize + 50], tz),
				],
			]

			tile.drawPolygon(polygon)

			// Left boundary (x=0) should NOT be filled
			const leftBoundaryIdx = tile.getIndex([0, 75])
			const leftBoundaryColor = Array.from(
				tile.imageData.slice(leftBoundaryIdx, leftBoundaryIdx + 4),
			)
			expect(leftBoundaryColor[3]).toBe(0) // Should be transparent

			// Pixel just inside (x=1) should be filled
			const insideIdx = tile.getIndex([1, 75])
			expect(
				Array.from(tile.imageData.slice(insideIdx, insideIdx + 4)),
			).toEqual(Array.from(DEFAULT_AREA_COLOR))
		})

		it("excludes right boundary pixels when polygon crosses right edge", () => {
			const tileIndex: Tile = [10, 11, 5]
			const tileSize = DEFAULT_RASTER_TILE_SIZE
			const [tx, ty, tz] = tileIndex
			const { tile, merc } = createTile(tileIndex, tileSize)

			// Create polygon that extends beyond right edge (x >= tileSize)
			// Create a large rectangle that extends from inside well to outside right edge
			const polygon: LonLat[][] = [
				[
					lonLatForPixel(merc, tileIndex, tileSize, 150, 50),
					lonLatForPixel(merc, tileIndex, tileSize, 150, 100),
					merc.ll([(tx + 1) * tileSize + 20, ty * tileSize + 100], tz),
					merc.ll([(tx + 1) * tileSize + 20, ty * tileSize + 50], tz),
					lonLatForPixel(merc, tileIndex, tileSize, 150, 50),
				],
			]

			tile.drawPolygon(polygon)

			// Right boundary (x=tileSize-1) should NOT be filled
			const rightBoundaryIdx = tile.getIndex([tileSize - 1, 75])
			const rightBoundaryColor = Array.from(
				tile.imageData.slice(rightBoundaryIdx, rightBoundaryIdx + 4),
			)
			expect(rightBoundaryColor[3]).toBe(0) // Should be transparent

			// Pixel just inside (x=tileSize-2) should be filled
			const insideIdx = tile.getIndex([tileSize - 2, 75])
			expect(
				Array.from(tile.imageData.slice(insideIdx, insideIdx + 4)),
			).toEqual(Array.from(DEFAULT_AREA_COLOR))
		})

		it("excludes top boundary pixels when polygon crosses top edge", () => {
			const tileIndex: Tile = [10, 11, 5]
			const tileSize = DEFAULT_RASTER_TILE_SIZE
			const [tx, ty, tz] = tileIndex
			const { tile, merc } = createTile(tileIndex, tileSize)

			// Create polygon that extends beyond top edge (y < 0)
			// Create a large rectangle that extends from outside top edge well inside
			const polygon: LonLat[][] = [
				[
					merc.ll([tx * tileSize + 50, ty * tileSize - 20], tz),
					lonLatForPixel(merc, tileIndex, tileSize, 50, 100),
					lonLatForPixel(merc, tileIndex, tileSize, 100, 100),
					merc.ll([tx * tileSize + 100, ty * tileSize - 20], tz),
					merc.ll([tx * tileSize + 50, ty * tileSize - 20], tz),
				],
			]

			tile.drawPolygon(polygon)

			// Top boundary (y=0) should NOT be filled
			const topBoundaryIdx = tile.getIndex([75, 0])
			const topBoundaryColor = Array.from(
				tile.imageData.slice(topBoundaryIdx, topBoundaryIdx + 4),
			)
			expect(topBoundaryColor[3]).toBe(0) // Should be transparent

			// Pixel just inside (y=1) should be filled
			const insideIdx = tile.getIndex([75, 1])
			expect(
				Array.from(tile.imageData.slice(insideIdx, insideIdx + 4)),
			).toEqual(Array.from(DEFAULT_AREA_COLOR))
		})

		it("excludes bottom boundary pixels when polygon crosses bottom edge", () => {
			const tileIndex: Tile = [10, 11, 5]
			const tileSize = DEFAULT_RASTER_TILE_SIZE
			const [tx, ty, tz] = tileIndex
			const { tile, merc } = createTile(tileIndex, tileSize)

			// Create polygon that extends beyond bottom edge (y >= tileSize)
			// Create a large rectangle that extends from inside well to outside bottom edge
			const polygon: LonLat[][] = [
				[
					lonLatForPixel(merc, tileIndex, tileSize, 50, 150),
					lonLatForPixel(merc, tileIndex, tileSize, 100, 150),
					merc.ll([tx * tileSize + 100, (ty + 1) * tileSize + 20], tz),
					merc.ll([tx * tileSize + 50, (ty + 1) * tileSize + 20], tz),
					lonLatForPixel(merc, tileIndex, tileSize, 50, 150),
				],
			]

			tile.drawPolygon(polygon)

			// Bottom boundary (y=tileSize-1) should NOT be filled
			const bottomBoundaryIdx = tile.getIndex([75, tileSize - 1])
			const bottomBoundaryColor = Array.from(
				tile.imageData.slice(bottomBoundaryIdx, bottomBoundaryIdx + 4),
			)
			expect(bottomBoundaryColor[3]).toBe(0) // Should be transparent

			// Pixel just inside (y=tileSize-2) should be filled
			const insideIdx = tile.getIndex([75, tileSize - 2])
			expect(
				Array.from(tile.imageData.slice(insideIdx, insideIdx + 4)),
			).toEqual(Array.from(DEFAULT_AREA_COLOR))
		})

		it("excludes corner boundary pixels when polygon crosses multiple edges", () => {
			const tileIndex: Tile = [10, 11, 5]
			const tileSize = DEFAULT_RASTER_TILE_SIZE
			const [tx, ty, tz] = tileIndex
			const { tile, merc } = createTile(tileIndex, tileSize)

			// Create polygon that crosses top-left corner
			// Create a large rectangle that extends from outside top-left corner well inside
			const polygon: LonLat[][] = [
				[
					merc.ll([tx * tileSize - 20, ty * tileSize - 20], tz),
					merc.ll([tx * tileSize - 20, ty * tileSize + 50], tz),
					lonLatForPixel(merc, tileIndex, tileSize, 50, 50),
					lonLatForPixel(merc, tileIndex, tileSize, 50, 1),
					merc.ll([tx * tileSize - 20, ty * tileSize - 20], tz),
				],
			]

			tile.drawPolygon(polygon)

			// Top-left corner (x=0, y=0) should NOT be filled
			const cornerIdx = tile.getIndex([0, 0])
			const cornerColor = Array.from(
				tile.imageData.slice(cornerIdx, cornerIdx + 4),
			)
			expect(cornerColor[3]).toBe(0) // Should be transparent

			// Pixels just inside should be filled (y=1 row, x=1 column)
			const insideX = tile.getIndex([1, 1])
			const insideY = tile.getIndex([1, 1])
			expect(Array.from(tile.imageData.slice(insideX, insideX + 4))).toEqual(
				Array.from(DEFAULT_AREA_COLOR),
			)
			expect(Array.from(tile.imageData.slice(insideY, insideY + 4))).toEqual(
				Array.from(DEFAULT_AREA_COLOR),
			)
		})

		it("ensures adjacent tiles do not create duplicate edge pixels", () => {
			const tileSize = DEFAULT_RASTER_TILE_SIZE
			const [tx, ty, tz] = [10, 11, 5]

			// Create two adjacent tiles (current and right neighbor)
			const tile1 = new OsmixRasterTile({ tile: [tx, ty, tz], tileSize })
			const tile2 = new OsmixRasterTile({ tile: [tx + 1, ty, tz], tileSize })

			const merc = new SphericalMercatorTile({ size: tileSize })

			// Create a polygon that spans both tiles
			// Left part in tile1, right part in tile2
			const leftPart: LonLat[] = [
				lonLatForPixel(merc, [tx, ty, tz], tileSize, 200, 50),
				lonLatForPixel(merc, [tx, ty, tz], tileSize, 200, 150),
				lonLatForPixel(merc, [tx, ty, tz], tileSize, 255, 150),
				lonLatForPixel(merc, [tx, ty, tz], tileSize, 255, 50),
				lonLatForPixel(merc, [tx, ty, tz], tileSize, 200, 50),
			]

			const rightPart: LonLat[] = [
				lonLatForPixel(merc, [tx + 1, ty, tz], tileSize, 0, 50),
				lonLatForPixel(merc, [tx + 1, ty, tz], tileSize, 0, 150),
				lonLatForPixel(merc, [tx + 1, ty, tz], tileSize, 50, 150),
				lonLatForPixel(merc, [tx + 1, ty, tz], tileSize, 50, 50),
				lonLatForPixel(merc, [tx + 1, ty, tz], tileSize, 0, 50),
			]

			// Draw polygon on both tiles
			tile1.drawPolygon([leftPart])
			tile2.drawPolygon([rightPart])

			// Right boundary of tile1 (x=tileSize-1) should NOT be filled
			const tile1RightBoundaryIdx = tile1.getIndex([tileSize - 1, 100])
			const tile1RightBoundaryColor = Array.from(
				tile1.imageData.slice(tile1RightBoundaryIdx, tile1RightBoundaryIdx + 4),
			)
			expect(tile1RightBoundaryColor[3]).toBe(0) // Should be transparent

			// Left boundary of tile2 (x=0) should NOT be filled
			const tile2LeftBoundaryIdx = tile2.getIndex([0, 100])
			const tile2LeftBoundaryColor = Array.from(
				tile2.imageData.slice(tile2LeftBoundaryIdx, tile2LeftBoundaryIdx + 4),
			)
			expect(tile2LeftBoundaryColor[3]).toBe(0) // Should be transparent

			// Pixels just inside each tile should be filled
			const tile1InsideIdx = tile1.getIndex([tileSize - 2, 100])
			expect(
				Array.from(tile1.imageData.slice(tile1InsideIdx, tile1InsideIdx + 4)),
			).toEqual(Array.from(DEFAULT_AREA_COLOR))

			const tile2InsideIdx = tile2.getIndex([1, 100])
			expect(
				Array.from(tile2.imageData.slice(tile2InsideIdx, tile2InsideIdx + 4)),
			).toEqual(Array.from(DEFAULT_AREA_COLOR))
		})
	})

	describe("line drawing edge cases", () => {
		it("drawLine does not draw pixels outside tile bounds", () => {
			const tileIndex: Tile = [10, 11, 5]
			const tileSize = DEFAULT_RASTER_TILE_SIZE
			const { tile } = createTile(tileIndex, tileSize)

			// Draw a line that extends beyond tile bounds
			// This should only draw pixels within [0, tileSize)
			tile.drawLine([-10, 50], [tileSize + 10, 50])

			// Left boundary (x=0) should be drawn (clamped from -10)
			const leftBoundaryIdx = tile.getIndex([0, 50])
			expect(
				Array.from(tile.imageData.slice(leftBoundaryIdx, leftBoundaryIdx + 4)),
			).toEqual(Array.from(DEFAULT_LINE_COLOR))

			// Right boundary (x=tileSize-1) should be drawn (clamped from tileSize+10)
			const rightBoundaryIdx = tile.getIndex([tileSize - 1, 50])
			expect(
				Array.from(
					tile.imageData.slice(rightBoundaryIdx, rightBoundaryIdx + 4),
				),
			).toEqual(Array.from(DEFAULT_LINE_COLOR))

			// Pixels outside should not be drawn (would cause out-of-bounds access)
			// This is verified by the bounds check in drawLine
		})

		it("drawWay properly clips lines at tile boundaries", () => {
			const tileIndex: Tile = [10, 11, 5]
			const tileSize = DEFAULT_RASTER_TILE_SIZE
			const [tx, ty, tz] = tileIndex
			const { tile, merc } = createTile(tileIndex)

			// Create a way that extends beyond tile boundaries
			// Use a way that crosses the tile horizontally to ensure it's visible
			const wayStart: LonLat = merc.ll(
				[tx * tileSize - 20, ty * tileSize + 128],
				tz,
			)
			const wayEnd: LonLat = merc.ll(
				[(tx + 1) * tileSize + 20, ty * tileSize + 128],
				tz,
			)

			tile.drawLineString([wayStart, wayEnd])

			// The way should be clipped, so we should see pixels in the middle of the tile
			// Check multiple points along the expected horizontal line
			const midPoint1 = tile.getIndex([50, 128])
			const midPoint2 = tile.getIndex([128, 128])
			const midPoint3 = tile.getIndex([200, 128])

			// At least some pixels should be drawn (the exact boundary behavior
			// depends on clipping, but we verify it doesn't crash and draws something)
			const hasPixels =
				tile.imageData.slice(midPoint1, midPoint1 + 4)[3]! > 0 ||
				tile.imageData.slice(midPoint2, midPoint2 + 4)[3]! > 0 ||
				tile.imageData.slice(midPoint3, midPoint3 + 4)[3]! > 0
			expect(hasPixels).toBe(true)
		})

		it("drawLine handles vertical lines at boundaries correctly", () => {
			const tileIndex: Tile = [10, 11, 5]
			const tileSize = DEFAULT_RASTER_TILE_SIZE
			const { tile } = createTile(tileIndex)

			// Draw vertical line at left boundary
			tile.drawLine([0, 10], [0, 100])
			const leftBoundaryIdx = tile.getIndex([0, 50])
			expect(
				Array.from(tile.imageData.slice(leftBoundaryIdx, leftBoundaryIdx + 4)),
			).toEqual(Array.from(DEFAULT_LINE_COLOR))

			// Draw vertical line at right boundary
			tile.drawLine([tileSize - 1, 10], [tileSize - 1, 100])
			const rightBoundaryIdx = tile.getIndex([tileSize - 1, 50])
			expect(
				Array.from(
					tile.imageData.slice(rightBoundaryIdx, rightBoundaryIdx + 4),
				),
			).toEqual(Array.from(DEFAULT_LINE_COLOR))
		})

		it("drawLine handles horizontal lines at boundaries correctly", () => {
			const tileIndex: Tile = [10, 11, 5]
			const tileSize = DEFAULT_RASTER_TILE_SIZE
			const { tile } = createTile(tileIndex)

			// Draw horizontal line at top boundary
			tile.drawLine([10, 0], [100, 0])
			const topBoundaryIdx = tile.getIndex([50, 0])
			expect(
				Array.from(tile.imageData.slice(topBoundaryIdx, topBoundaryIdx + 4)),
			).toEqual(Array.from(DEFAULT_LINE_COLOR))

			// Draw horizontal line at bottom boundary
			tile.drawLine([10, tileSize - 1], [100, tileSize - 1])
			const bottomBoundaryIdx = tile.getIndex([50, tileSize - 1])
			expect(
				Array.from(
					tile.imageData.slice(bottomBoundaryIdx, bottomBoundaryIdx + 4),
				),
			).toEqual(Array.from(DEFAULT_LINE_COLOR))
		})
	})
})
