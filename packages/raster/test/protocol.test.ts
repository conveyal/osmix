import type { Tile } from "@osmix/shared/types"
import type { RequestParameters } from "maplibre-gl"
import { describe, expect, it, vi } from "vitest"
import { createOsmixRasterMaplibreProtocol } from "../src/protocol"
import { DEFAULT_RASTER_TILE_SIZE } from "../src/raster-tile"

describe("createOsmixRasterMaplibreProtocol", () => {
	it("parses raster URLs and forwards derived metadata to getTileImage", async () => {
		const tileSize = 512
		const tileIndex: Tile = [4, 5, 3]
		const expectedData = new ArrayBuffer(4)
		const getTileImage = vi.fn().mockResolvedValue(expectedData)
		const protocol = createOsmixRasterMaplibreProtocol(getTileImage)

		const request: RequestParameters = {
			url: `@osmix/raster://test-osm/${tileSize}/${tileIndex[2]}/${tileIndex[0]}/${tileIndex[1]}.png`,
			cache: "no-store",
		}
		const response = await protocol(request, new AbortController())

		expect(getTileImage).toHaveBeenCalledTimes(1)
		const [osmId, passedTileIndex, passedTileSize] = getTileImage.mock
			.calls[0] as Parameters<typeof getTileImage>
		expect(osmId).toBe("test-osm")
		expect(passedTileSize).toBe(tileSize)
		expect(passedTileIndex).toEqual(tileIndex)

		expect(response.data).toBe(expectedData)
		expect(response.cacheControl).toBe("no-store")
	})

	it("falls back to defaults for missing content type, tile size, and cache", async () => {
		const expectedData = new ArrayBuffer(8)
		const getTileImage = vi.fn().mockResolvedValue(expectedData)
		const protocol = createOsmixRasterMaplibreProtocol(getTileImage)

		const request: RequestParameters = {
			url: `@osmix/raster://foo/${DEFAULT_RASTER_TILE_SIZE}/9/1/2.png`,
		}
		const response = await protocol(request, new AbortController())

		expect(getTileImage).toHaveBeenCalledTimes(1)
		const [, , passedTileSize] = getTileImage.mock.calls[0] as Parameters<
			typeof getTileImage
		>
		expect(passedTileSize).toBe(DEFAULT_RASTER_TILE_SIZE)
		expect(response.cacheControl).toBe("no-store")
	})

	it("throws when the URL does not match the expected format", async () => {
		const getTileImage = vi.fn()
		const protocol = createOsmixRasterMaplibreProtocol(getTileImage)
		await expect(
			protocol({ url: "@osmix/raster://bad-url" }, new AbortController()),
		).rejects.toThrow("Bad @osmix/raster URL")
		expect(getTileImage).not.toHaveBeenCalled()
	})
})
