import type { AddProtocolAction } from "maplibre-gl"
import type { TileIndex } from "./raster-tile"

export const RASTER_PROTOCOL_NAME = "@osmix/raster"

export type GetTileImage = (
	osmId: string,
	tileIndex: TileIndex,
	tileSize: number,
) => Promise<ArrayBuffer>

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
		const tileSize = +sizeStr
		const tileIndex: TileIndex = { z: +zStr, x: +xStr, y: +yStr }
		const data = await getTileImage(osmId, tileIndex, tileSize)
		return {
			data,
			cacheControl: req.cache ?? "force-cache",
			expires: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24 hours
		}
	}
}
