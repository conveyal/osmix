import { SphericalMercator } from "@mapbox/sphericalmercator"
import type { GeoBbox2D } from "@osmix/json"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	DEFAULT_NODE_COLOR,
	DEFAULT_RASTER_IMAGE_TYPE,
	DEFAULT_TILE_SIZE,
	DEFAULT_WAY_COLOR,
	OsmixRasterTile,
	type TileIndex,
} from "../src/raster-tile"
import { rasterTileToImageBuffer } from "./to-image-buffer"

function createTile(
	tileIndex: TileIndex = { z: 3, x: 4, y: 5 },
	tileSize = 64,
) {
	const merc = new SphericalMercator({ size: tileSize })
	const bbox = merc.bbox(tileIndex.x, tileIndex.y, tileIndex.z) as GeoBbox2D
	return {
		tile: new OsmixRasterTile(bbox, tileIndex, tileSize),
		merc,
	}
}

function lonLatForPixel(
	merc: SphericalMercator,
	tileIndex: TileIndex,
	tileSize: number,
	px: number,
	py: number,
): [number, number] {
	return merc.ll(
		[tileIndex.x * tileSize + px, tileIndex.y * tileSize + py],
		tileIndex.z,
	) as [number, number]
}

describe("OsmixRasterTile", () => {
	it("projects lon/lat to tile-local pixels and clamps out-of-bounds values", () => {
		const tileIndex: TileIndex = { z: 2, x: 1, y: 1 }
		const { tile, merc } = createTile(tileIndex, DEFAULT_TILE_SIZE)

		const insideLonLat = lonLatForPixel(merc, tileIndex, tile.tileSize, 32, 16)
		expect(tile.lonLatToTilePixel(insideLonLat)).toEqual([32, 16])

		const outsideTopLeft = merc.ll(
			[tileIndex.x * tile.tileSize - 10, tileIndex.y * tile.tileSize - 10],
			tileIndex.z,
		) as [number, number]
		expect(tile.lonLatToTilePixel(outsideTopLeft)).toEqual([0, 0])

		const outsideBottomRight = merc.ll(
			[
				(tileIndex.x + 1) * tile.tileSize + 10,
				(tileIndex.y + 1) * tile.tileSize + 10,
			],
			tileIndex.z,
		) as [number, number]
		expect(tile.lonLatToTilePixel(outsideBottomRight)).toEqual([
			tile.tileSize - 1,
			tile.tileSize - 1,
		])
	})

	it("sets point pixels using lon/lat coordinates", () => {
		const tileIndex: TileIndex = { z: 4, x: 6, y: 7 }
		const { tile, merc } = createTile(tileIndex)
		const nodePixel = [12, 20] as const
		const nodeLonLat = lonLatForPixel(
			merc,
			tileIndex,
			tile.tileSize,
			nodePixel[0],
			nodePixel[1],
		)

		tile.setLonLat(nodeLonLat)

		const idx = (nodePixel[1] * tile.tileSize + nodePixel[0]) * 4
		expect(Array.from(tile.imageData.slice(idx, idx + 4))).toEqual(
			Array.from(DEFAULT_NODE_COLOR),
		)
	})

	it("draws clipped ways using Bresenham line rendering", () => {
		const tileIndex: TileIndex = { z: 5, x: 10, y: 11 }
		const { tile, merc } = createTile(tileIndex)

		const startPixel = [5, 5] as const
		const endPixel = [40, 36] as const

		const way = [
			lonLatForPixel(
				merc,
				tileIndex,
				tile.tileSize,
				startPixel[0],
				startPixel[1],
			),
			lonLatForPixel(merc, tileIndex, tile.tileSize, endPixel[0], endPixel[1]),
		]

		// Prefix and suffix points outside the tile bounds to exercise clipping.
		const outsidePrefix = merc.ll(
			[tileIndex.x * tile.tileSize - 20, tileIndex.y * tile.tileSize - 20],
			tileIndex.z,
		) as [number, number]
		const outsideSuffix = merc.ll(
			[
				(tileIndex.x + 1) * tile.tileSize + 20,
				(tileIndex.y + 1) * tile.tileSize + 20,
			],
			tileIndex.z,
		) as [number, number]

		tile.drawWay([outsidePrefix, ...way, outsideSuffix])

		const startIdx = (startPixel[1] * tile.tileSize + startPixel[0]) * 4
		const endIdx = (endPixel[1] * tile.tileSize + endPixel[0]) * 4
		expect(Array.from(tile.imageData.slice(startIdx, startIdx + 4))).toEqual(
			Array.from(DEFAULT_WAY_COLOR),
		)
		expect(Array.from(tile.imageData.slice(endIdx, endIdx + 4))).toEqual(
			Array.from(DEFAULT_WAY_COLOR),
		)
	})

	describe("toImageBuffer", () => {
		const originalOffscreenCanvas = globalThis.OffscreenCanvas
		const originalImageData = globalThis.ImageData

		afterEach(() => {
			globalThis.OffscreenCanvas = originalOffscreenCanvas
			globalThis.ImageData = originalImageData
			vi.restoreAllMocks()
		})

		it("serializes image data via OffscreenCanvas", async () => {
			const { tile } = createTile()
			const arrayBuffer = new ArrayBuffer(16)
			const putImageData = vi.fn()
			const convertToBlob = vi
				.fn()
				.mockResolvedValue({ arrayBuffer: () => Promise.resolve(arrayBuffer) })
			let latestCanvas: MockOffscreenCanvas | undefined

			class MockContext2D {
				putImageData = putImageData
			}

			class MockOffscreenCanvas {
				width: number
				height: number
				ctx = new MockContext2D()
				constructor(width: number, height: number) {
					this.width = width
					this.height = height
					latestCanvas = this
				}
				getContext(type: string) {
					if (type !== "2d") return null
					return this.ctx
				}
				convertToBlob = convertToBlob
			}

			class MockImageData {
				data: Uint8ClampedArray
				width: number
				height: number
				constructor(data: Uint8ClampedArray, width: number, height: number) {
					this.data = data
					this.width = width
					this.height = height
				}
			}

			globalThis.OffscreenCanvas =
				MockOffscreenCanvas as unknown as typeof OffscreenCanvas
			globalThis.ImageData = MockImageData as unknown as typeof ImageData

			const result = await rasterTileToImageBuffer(tile)

			expect(result).toBe(arrayBuffer)
			expect(putImageData).toHaveBeenCalledTimes(1)
			expect(latestCanvas?.convertToBlob).toHaveBeenCalledWith({
				type: DEFAULT_RASTER_IMAGE_TYPE,
			})
		})
	})
})
