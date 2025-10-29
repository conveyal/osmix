import SphericalMercatorTile from "@osmix/shared/spherical-mercator"
import type { LonLat, Tile, XY } from "@osmix/shared/types"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	DEFAULT_NODE_COLOR,
	DEFAULT_RASTER_IMAGE_TYPE,
	DEFAULT_RASTER_TILE_SIZE,
	DEFAULT_WAY_COLOR,
	OsmixRasterTile,
} from "../src/raster-tile"
import { rasterTileToImageBuffer } from "./to-image-buffer"

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
