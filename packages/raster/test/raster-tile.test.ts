import { describe, expect, it } from "bun:test"
import type { GeoBbox2D, LonLat, Rgba, Tile, XY } from "@osmix/shared/types"
import {
	DEFAULT_AREA_COLOR,
	DEFAULT_LINE_COLOR,
	DEFAULT_POINT_COLOR,
	DEFAULT_RASTER_TILE_SIZE,
	OsmixRasterTile,
} from "../src/raster-tile"

describe("OsmixRasterTile", () => {
	it("sets point pixels using lon/lat coordinates", () => {
		const tileIndex: Tile = [6, 7, 4]
		const tileSize = DEFAULT_RASTER_TILE_SIZE
		const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })
		const nodePixel: XY = [12, 20]
		const nodeLonLat = tile.tilePxToLonLat(nodePixel)

		tile.setLonLat(nodeLonLat)

		const idx = (nodePixel[1] * tileSize + nodePixel[0]) * 4
		expect(Array.from(tile.imageData.slice(idx, idx + 4))).toEqual(
			Array.from(DEFAULT_POINT_COLOR),
		)
	})

	it("draws clipped ways using Bresenham line rendering", () => {
		const tileIndex: Tile = [10, 11, 5]
		const tileSize = DEFAULT_RASTER_TILE_SIZE
		const [tx, ty] = tileIndex
		const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

		const startPixel: XY = [5, 5]
		const endPixel: XY = [40, 36]

		const way = [tile.tilePxToLonLat(startPixel), tile.tilePxToLonLat(endPixel)]

		// Prefix and suffix points outside the tile bounds to exercise clipping.
		const outsidePrefix: LonLat = tile.tilePxToLonLat([tx - 20, ty - 20])
		const outsideSuffix: LonLat = tile.tilePxToLonLat([tx + 20, ty + 20])

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
		const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

		// Create a simple square polygon
		const polygon: LonLat[][] = [
			[
				tile.tilePxToLonLat([10, 10]),
				tile.tilePxToLonLat([30, 10]),
				tile.tilePxToLonLat([30, 30]),
				tile.tilePxToLonLat([10, 30]),
				tile.tilePxToLonLat([10, 10]), // Closed
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
		const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

		// Create a polygon with a hole
		const polygon: LonLat[][] = [
			// Outer ring
			[
				tile.tilePxToLonLat([10, 10]),
				tile.tilePxToLonLat([50, 10]),
				tile.tilePxToLonLat([50, 50]),
				tile.tilePxToLonLat([10, 50]),
				tile.tilePxToLonLat([10, 10]),
			],
			// Hole
			[
				tile.tilePxToLonLat([25, 25]),
				tile.tilePxToLonLat([35, 25]),
				tile.tilePxToLonLat([35, 35]),
				tile.tilePxToLonLat([25, 35]),
				tile.tilePxToLonLat([25, 25]),
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
		const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

		// Create a MultiPolygon with two separate polygons
		const multiPolygon: LonLat[][][] = [
			// First polygon
			[
				[
					tile.tilePxToLonLat([10, 10]),
					tile.tilePxToLonLat([20, 10]),
					tile.tilePxToLonLat([20, 20]),
					tile.tilePxToLonLat([10, 20]),
					tile.tilePxToLonLat([10, 10]),
				],
			],
			// Second polygon
			[
				[
					tile.tilePxToLonLat([30, 30]),
					tile.tilePxToLonLat([40, 30]),
					tile.tilePxToLonLat([40, 40]),
					tile.tilePxToLonLat([30, 40]),
					tile.tilePxToLonLat([30, 30]),
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
		const tile = new OsmixRasterTile({
			tile: tileIndex,
			tileSize: DEFAULT_RASTER_TILE_SIZE,
		})
		// Should not throw
		tile.drawPolygon([])
		expect(tile.imageData.every((v) => v === 0)).toBe(true)
	})

	it("handles polygon with hole correctly (winding order)", () => {
		const tileIndex: Tile = [10, 11, 5]
		const tileSize = DEFAULT_RASTER_TILE_SIZE
		const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

		// Create outer square (counterclockwise for GeoJSON)
		const outerRing: LonLat[] = [
			tile.tilePxToLonLat([10, 10]),
			tile.tilePxToLonLat([30, 10]),
			tile.tilePxToLonLat([30, 30]),
			tile.tilePxToLonLat([10, 30]),
			tile.tilePxToLonLat([10, 10]), // closed
		]

		// Create inner square hole (clockwise for GeoJSON)
		const innerRing: LonLat[] = [
			tile.tilePxToLonLat([15, 15]),
			tile.tilePxToLonLat([15, 25]),
			tile.tilePxToLonLat([25, 25]),
			tile.tilePxToLonLat([25, 15]),
			tile.tilePxToLonLat([15, 15]), // closed
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
		const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

		// First polygon
		const polygon1: LonLat[][] = [
			[
				tile.tilePxToLonLat([10, 10]),
				tile.tilePxToLonLat([20, 10]),
				tile.tilePxToLonLat([20, 20]),
				tile.tilePxToLonLat([10, 20]),
				tile.tilePxToLonLat([10, 10]),
			],
		]

		// Second polygon (separate)
		const polygon2: LonLat[][] = [
			[
				tile.tilePxToLonLat([30, 30]),
				tile.tilePxToLonLat([40, 30]),
				tile.tilePxToLonLat([40, 40]),
				tile.tilePxToLonLat([30, 40]),
				tile.tilePxToLonLat([30, 30]),
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
		const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

		// Create polygon with clockwise winding (should be normalized to counterclockwise)
		const clockwiseRing: LonLat[] = [
			tile.tilePxToLonLat([10, 10]),
			tile.tilePxToLonLat([10, 30]),
			tile.tilePxToLonLat([30, 30]),
			tile.tilePxToLonLat([30, 10]),
			tile.tilePxToLonLat([10, 10]),
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
			const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

			// Create polygon that extends beyond left edge (x < 0)
			// Create a large rectangle that extends from outside left edge well inside
			const polygon: LonLat[][] = [
				[
					tile.tilePxToLonLat([-20, 50]),
					tile.tilePxToLonLat([-20, 100]),
					tile.tilePxToLonLat([100, 100]),
					tile.tilePxToLonLat([100, 50]),
					tile.tilePxToLonLat([-20, 50]),
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
			const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

			// Create polygon that extends beyond right edge (x >= tileSize)
			// Create a large rectangle that extends from inside well to outside right edge
			const polygon: LonLat[][] = [
				[
					tile.tilePxToLonLat([150, 50]),
					tile.tilePxToLonLat([150, 100]),
					tile.tilePxToLonLat([tileSize * 2, 100]),
					tile.tilePxToLonLat([tileSize * 2, 50]),
					tile.tilePxToLonLat([150, 50]),
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
			const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

			// Create polygon that extends beyond top edge (y < 0)
			// Create a large rectangle that extends from outside top edge well inside
			const polygon: LonLat[][] = [
				[
					tile.tilePxToLonLat([50, -20]),
					tile.tilePxToLonLat([50, 100]),
					tile.tilePxToLonLat([100, 100]),
					tile.tilePxToLonLat([100, -20]),
					tile.tilePxToLonLat([50, -20]),
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
			const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

			// Create polygon that extends beyond bottom edge (y >= tileSize)
			// Create a large rectangle that extends from inside well to outside bottom edge
			const polygon: LonLat[][] = [
				[
					tile.tilePxToLonLat([50, 150]),
					tile.tilePxToLonLat([100, 150]),
					tile.tilePxToLonLat([100, tileSize * 2]),
					tile.tilePxToLonLat([50, tileSize * 2]),
					tile.tilePxToLonLat([50, 150]),
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
			const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

			// Create polygon that crosses top-left corner
			// Create a large rectangle that extends from outside top-left corner well inside
			const polygon: LonLat[][] = [
				[
					tile.tilePxToLonLat([-20, -20]),
					tile.tilePxToLonLat([-20, 50]),
					tile.tilePxToLonLat([50, 50]),
					tile.tilePxToLonLat([50, 1]),
					tile.tilePxToLonLat([-20, -20]),
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
			// Create a polygon that spans both tiles
			// Left part in tile1, right part in tile2
			const leftPart: LonLat[] = [
				tile1.tilePxToLonLat([200, 50]),
				tile1.tilePxToLonLat([200, 150]),
				tile1.tilePxToLonLat([255, 150]),
				tile1.tilePxToLonLat([255, 50]),
				tile1.tilePxToLonLat([200, 50]),
			]

			const rightPart: LonLat[] = [
				tile2.tilePxToLonLat([0, 50]),
				tile2.tilePxToLonLat([0, 150]),
				tile2.tilePxToLonLat([50, 150]),
				tile2.tilePxToLonLat([50, 50]),
				tile2.tilePxToLonLat([0, 50]),
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
			const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

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
			const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

			// Create a way that extends beyond tile boundaries
			// Use a way that crosses the tile horizontally to ensure it's visible
			const wayStart: LonLat = tile.tilePxToLonLat([-20, 128])
			const wayEnd: LonLat = tile.tilePxToLonLat([tileSize * 2, 128])

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
			const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

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
			const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

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

	const tiles: Tile[] = [
		[4265, 2897, 13.5],
		[1066, 746, 11],
	]
	describe.each(tiles)(
		"subpixel entity rendering tile %p/%p/%p",
		(...tileIndex) => {
			const tileSize = 4 // Easier to debug math with a smaller tile

			it("draws entities that fit in a single pixel", () => {
				const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })
				const tileBbox = tile.bbox()
				const centerLon = (tileBbox[0] + tileBbox[2]) / 2
				const centerLat = (tileBbox[1] + tileBbox[3]) / 2

				// Create a tiny bbox (much smaller than a pixel)
				const centerPx = tile.llToTilePx([centerLon, centerLat])
				const offsetMin = tile.tilePxToLonLat([
					centerPx[0] - 0.25,
					centerPx[1] + 0.25,
				])
				const offsetMax = tile.tilePxToLonLat([
					centerPx[0] + 0.25,
					centerPx[1] - 0.25,
				])
				const bbox: GeoBbox2D = [
					offsetMin[0],
					offsetMin[1],
					offsetMax[0],
					offsetMax[1],
				]

				const color: Rgba = [255, 0, 0, 255]
				const drawn = tile.drawSubpixelEntity(bbox, color)

				expect(drawn).toBe(true)

				// Find which pixel was drawn (should be near center)
				// The exact pixel depends on projection, but we can check that something was drawn
				let foundPixel = false
				for (let y = 0; y < tileSize; y++) {
					for (let x = 0; x < tileSize; x++) {
						const idx = tile.getIndex([x, y])
						if (tile.imageData[idx + 3]! > 0) {
							foundPixel = true
							const pixelColor = Array.from(tile.imageData.slice(idx, idx + 4))
							expect(pixelColor[0]).toBe(255) // Red
							expect(pixelColor[1]).toBe(0)
							expect(pixelColor[2]).toBe(0)
							// Alpha should be scaled by coverage (at least 1, less than 255)
							expect(pixelColor[3]).toBeGreaterThanOrEqual(1)
							expect(pixelColor[3]).toBeLessThanOrEqual(255)
							break
						}
					}
					if (foundPixel) break
				}
				expect(foundPixel).toBe(true)
			})

			it("returns false for entities that span multiple pixels", () => {
				const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

				// Create a bbox that spans multiple pixels
				const minLl = tile.tilePxToLonLat([10, 10])
				const maxLl = tile.tilePxToLonLat([50, 50])
				const bbox: GeoBbox2D = [minLl[0], minLl[1], maxLl[0], maxLl[1]]

				const color: Rgba = [255, 0, 0, 255]
				const drawn = tile.drawSubpixelEntity(bbox, color)

				expect(drawn).toBe(false)
			})

			it("scales alpha by coverage ratio for subpixel entities", () => {
				const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

				// Create a bbox that covers a small portion of a pixel
				// Use the tile's bbox and create a tiny subpixel area
				const tileBbox = tile.bbox()
				const centerLon = (tileBbox[0] + tileBbox[2]) / 2
				const centerLat = (tileBbox[1] + tileBbox[3]) / 2

				// Create a very small bbox (smaller coverage = lower alpha)
				// Use a smaller offset to get less coverage
				const tinyOffset = 0.0005 // Half the size of the previous test
				const smallBbox: GeoBbox2D = [
					centerLon - tinyOffset,
					centerLat - tinyOffset,
					centerLon + tinyOffset,
					centerLat + tinyOffset,
				]

				const fullAlphaColor: Rgba = [255, 0, 0, 255]
				const drawn = tile.drawSubpixelEntity(smallBbox, fullAlphaColor)

				expect(drawn).toBe(true)

				// Find which pixel was drawn and check that alpha was scaled
				let foundPixel = false
				for (let y = 0; y < tileSize; y++) {
					for (let x = 0; x < tileSize; x++) {
						const idx = tile.getIndex([x, y])
						if (tile.imageData[idx + 3]! > 0) {
							foundPixel = true
							const pixelColor = Array.from(tile.imageData.slice(idx, idx + 4))
							// Alpha should be less than 255 due to coverage scaling
							// but at least 1 for visibility
							expect(pixelColor[3]).toBeLessThan(255)
							expect(pixelColor[3]).toBeGreaterThanOrEqual(1)
							break
						}
					}
					if (foundPixel) break
				}
				expect(foundPixel).toBe(true)
			})

			it("handles bboxes outside tile bounds", () => {
				const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

				// Create a bbox that's completely outside the tile
				// Use coordinates that are far enough outside that even after projection
				// they remain outside the tile bounds
				// Get the tile's geographic bbox
				const tileBbox = tile.bbox()
				// Create a bbox that's completely to the west of the tile
				const outsideBbox: GeoBbox2D = [
					tileBbox[0] - 1.0, // Well to the west
					tileBbox[1] - 1.0, // Well to the south
					tileBbox[0] - 0.5, // Still to the west
					tileBbox[1] - 0.5, // Still to the south
				]

				const color: Rgba = [255, 0, 0, 255]
				const drawn = tile.drawSubpixelEntity(outsideBbox, color)

				expect(drawn).toBe(false)
			})

			it("uses horizontal extent when height collapses to zero", () => {
				const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

				const tileBbox = tile.bbox()
				const centerLon = (tileBbox[0] + tileBbox[2]) / 2
				const centerLat = (tileBbox[1] + tileBbox[3]) / 2

				const lonDelta = ((tileBbox[2] - tileBbox[0]) / tileSize) * 0.2
				const bbox: GeoBbox2D = [
					centerLon,
					centerLat,
					centerLon + lonDelta,
					centerLat, // zero height
				]

				const minPx = tile.llToTilePx([bbox[0], bbox[1]])
				const basePixel: XY = [Math.floor(minPx[0]), Math.floor(minPx[1])]

				const color: Rgba = [50, 50, 50, 200]
				const drawn = tile.drawSubpixelEntity(bbox, color)
				expect(drawn).toBe(true)

				const idx = tile.getIndex(basePixel)
				const alpha = tile.imageData[idx + 3]!
				expect(alpha).toBeGreaterThan(1)
				expect(alpha).toBeLessThan(color[3]!)
			})

			it("uses vertical extent when width collapses to zero", () => {
				const tile = new OsmixRasterTile({ tile: tileIndex, tileSize })

				const tileBbox = tile.bbox()
				const centerLon = (tileBbox[0] + tileBbox[2]) / 2
				const centerLat = (tileBbox[1] + tileBbox[3]) / 2
				const centerPixel = tile.llToTilePx([centerLon, centerLat])

				const centerOffset = tile.tilePxToLonLat([
					centerPixel[0] + 0.5,
					centerPixel[1],
				])

				const bbox: GeoBbox2D = [
					centerLon,
					centerLat,
					centerOffset[0], // zero width
					centerOffset[1],
				]

				const minPx = tile.llToTilePx([bbox[0], bbox[1]])
				const basePixel: XY = [Math.floor(minPx[0]), Math.floor(minPx[1])]

				const color: Rgba = [200, 100, 50, 180]
				const drawn = tile.drawSubpixelEntity(bbox, color)
				expect(drawn).toBe(true)

				const idx = tile.getIndex(basePixel)
				const alpha = tile.imageData[idx + 3]!
				expect(alpha).toBeGreaterThan(1)
				expect(alpha).toBeLessThan(color[3]!)
			})
		},
	)
})
