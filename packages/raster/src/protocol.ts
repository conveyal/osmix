import { assertValue } from "@osmix/shared/assert"
import type { Tile } from "@osmix/shared/types"
import type { AddProtocolAction } from "maplibre-gl"

export const RASTER_PROTOCOL_NAME = "@osmix/raster"

export type GetTileImage = (
	osmId: string,
	tileIndex: Tile,
	tileSize: number,
) => Promise<ArrayBuffer>

/**
 * Creates a MapLibre protocol action that handles requests for raster tiles. Caching should be handled by `getTileImage`.
 * @param getTileImage - A function that returns the image data for a given tile.
 * @returns A MapLibre protocol action that handles requests for raster tiles.
 */
export function createOsmixRasterMaplibreProtocol(
	getTileImage: GetTileImage,
): AddProtocolAction {
	return async (req): Promise<maplibregl.GetResourceResponse<ArrayBuffer>> => {
		// @osmix/raster://<osmId>/<tileSize>/<z>/<x>/<y>.png
		const m =
			/^@osmix\/raster:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(
				req.url,
			)
		if (!m) throw new Error(`Bad ${RASTER_PROTOCOL_NAME} URL: ${req.url}`)
		const [, osmId, sizeStr, zStr, xStr, yStr] = m
		assertValue(sizeStr, "Tile size is required in protocol URL")
		assertValue(zStr, "Tile index z is required in protocol URL")
		assertValue(xStr, "Tile index x is required in protocol URL")
		assertValue(yStr, "Tile index y is required in protocol URL")
		assertValue(osmId, "OSM ID is required in protocol URL")

		const tileSize = +sizeStr
		const tileIndex: Tile = [+xStr, +yStr, +zStr]
		const data = await getTileImage(osmId, tileIndex, tileSize)
		return {
			data,
			cacheControl: "no-store",
		}
	}
}
