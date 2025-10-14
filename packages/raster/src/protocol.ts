import { SphericalMercator } from "@mapbox/sphericalmercator"
import type { GeoBbox2D } from "@osmix/json"
import type { AddProtocolAction } from "maplibre-gl"
import type { TileIndex } from "./raster-tile"
import { DEFAULT_RASTER_IMAGE_TYPE, DEFAULT_TILE_SIZE } from "./raster-tile"

export const RASTER_PROTOCOL_NAME = "@osmix/raster"

type GetTileImage = (
	osmId: string,
	bbox: GeoBbox2D,
	tileIndex: TileIndex,
	tileSize: number,
) => Promise<{ data: ArrayBuffer; contentType?: string }>

export function createOsmixRasterMaplibreProtocol(
	getTileImage: GetTileImage,
	tileSize: number = DEFAULT_TILE_SIZE,
): AddProtocolAction {
	const merc = new SphericalMercator({ size: tileSize })
	return async (req) => {
		// @osmix/raster://<osmId>/<tileSize>/<z>/<x>/<y>.png
		const m =
			/^@osmix\/raster:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(
				req.url,
			)
		if (!m) throw new Error(`Bad ${RASTER_PROTOCOL_NAME} URL: ${req.url}`)
		const [, osmId, sizeStr, zStr, xStr, yStr] = m
		const tileSize = +sizeStr
		const tileIndex: TileIndex = { z: +zStr, x: +xStr, y: +yStr }
		const bbox = merc.bbox(tileIndex.x, tileIndex.y, tileIndex.z)
		const { data, contentType } = await getTileImage(
			osmId,
			bbox,
			tileIndex,
			tileSize,
		)
		return {
			data,
			contentType: contentType ?? DEFAULT_RASTER_IMAGE_TYPE,
			cacheControl: req.cache ?? "force-cache",
			expires: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24 hours
		}
	}
}
