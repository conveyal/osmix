import { SphericalMercator } from "@mapbox/sphericalmercator"
import { describe, expect, it, vi } from "vitest"
import {
	DEFAULT_RASTER_IMAGE_TYPE,
	DEFAULT_TILE_SIZE,
	type TileIndex,
} from "../src/raster-tile"
import { createOsmixRasterMaplibreProtocol } from "../src/protocol"

describe("createOsmixRasterMaplibreProtocol", () => {
	it("parses raster URLs and forwards derived metadata to getTileImage", async () => {
		const tileSize = 512
		const tileIndex: TileIndex = { z: 3, x: 4, y: 5 }
		const expectedData = new ArrayBuffer(4)
		const getTileImage = vi
			.fn()
			.mockResolvedValue({ data: expectedData, contentType: "image/webp" })
		const protocol = createOsmixRasterMaplibreProtocol(getTileImage, tileSize)

		const request = {
			url: "@osmix/raster://test-osm/512/3/4/5.png",
			cache: "no-store",
		}
		const response = await protocol(request as never)

		expect(getTileImage).toHaveBeenCalledTimes(1)
		const [osmId, bbox, passedTileIndex, passedTileSize] = getTileImage.mock
			.calls[0] as Parameters<typeof getTileImage>
		expect(osmId).toBe("test-osm")
		expect(passedTileSize).toBe(tileSize)
		expect(passedTileIndex).toEqual(tileIndex)

		const merc = new SphericalMercator({ size: tileSize })
		expect(bbox).toEqual(merc.bbox(tileIndex.x, tileIndex.y, tileIndex.z))

		expect(response.data).toBe(expectedData)
		expect(response.contentType).toBe("image/webp")
		expect(response.cacheControl).toBe("no-store")
	})

	it("falls back to defaults for missing content type, tile size, and cache", async () => {
		const expectedData = new ArrayBuffer(8)
		const getTileImage = vi
			.fn()
			.mockResolvedValue({ data: expectedData, contentType: undefined })
		const protocol = createOsmixRasterMaplibreProtocol(getTileImage)

		const request = { url: "@osmix/raster://foo/256/9/1/2.png" }
		const response = await protocol(request as never)

		expect(getTileImage).toHaveBeenCalledTimes(1)
		const [, , , passedTileSize] = getTileImage.mock.calls[0] as Parameters<
			typeof getTileImage
		>
		expect(passedTileSize).toBe(DEFAULT_TILE_SIZE)
		expect(response.contentType).toBe(DEFAULT_RASTER_IMAGE_TYPE)
		expect(response.cacheControl).toBe("force-cache")

		const now = Date.now()
		const expiresMs = response.expires.getTime() - now
		expect(expiresMs).toBeGreaterThan(1000 * 60 * 60 * 23)
		expect(expiresMs).toBeLessThan(1000 * 60 * 60 * 25)
	})

	it("throws when the URL does not match the expected format", async () => {
		const getTileImage = vi.fn()
		const protocol = createOsmixRasterMaplibreProtocol(getTileImage)
		await expect(
			protocol({ url: "@osmix/raster://bad-url" } as never),
		).rejects.toThrow("Bad @osmix/raster URL")
		expect(getTileImage).not.toHaveBeenCalled()
	})
})
