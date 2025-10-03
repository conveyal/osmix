import { SphericalMercator } from "@mapbox/sphericalmercator"
import type { TileIndex } from "@osmix/core"
import maplibre from "maplibre-gl"
import { RASTER_PROTOCOL_NAME, RASTER_TILE_SIZE } from "@/settings"
import { osmWorker } from "@/state/worker"

export function addOsmixRasterProtocol() {
	const merc = new SphericalMercator({ size: RASTER_TILE_SIZE })
	maplibre.addProtocol(RASTER_PROTOCOL_NAME, async (req) => {
		// @osmix/raster://<osmId>/<z>/<x>/<y>.png
		const m = /^@osmix\/raster:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(
			req.url,
		)
		if (!m) throw new Error(`Bad ${RASTER_PROTOCOL_NAME} URL: ${req.url}`)
		const [, osmId, zStr, xStr, yStr] = m
		const tileIndex: TileIndex = { z: +zStr, x: +xStr, y: +yStr }
		const bbox = merc.bbox(tileIndex.x, tileIndex.y, tileIndex.z)
		const { data, contentType } = await osmWorker.getTileImage(
			osmId,
			bbox,
			tileIndex,
		)
		return {
			data,
			contentType,
			cacheControl: req.cache ?? "force-cache",
			expires: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24 hours
		}
	})
}

export function removeOsmixRasterProtocol() {
	maplibre.removeProtocol(RASTER_PROTOCOL_NAME)
}
