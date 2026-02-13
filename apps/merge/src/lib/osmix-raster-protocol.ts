import type { Tile } from "@osmix/shared/types"
import maplibre from "maplibre-gl"
import { RASTER_PROTOCOL_NAME } from "../settings"
import { osmWorker } from "../state/worker"

export const RASTER_URL_PATTERN =
	/^@osmix\/raster:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.png$/

export function osmixIdToTileUrl(osmId: string, tileSize: number) {
	return `${RASTER_PROTOCOL_NAME}://${encodeURIComponent(osmId)}/${tileSize}/{z}/{x}/{y}.png`
}

/**
 * Creates a MapLibre protocol action that handles requests for raster tiles.
 */
export function addOsmixRasterProtocol() {
	maplibre.addProtocol(
		RASTER_PROTOCOL_NAME,
		async (req): Promise<maplibregl.GetResourceResponse<ArrayBuffer>> => {
			// @osmix/raster://<osmId>/<tileSize>/<z>/<x>/<y>.png
			const m =
				/^@osmix\/raster:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(
					req.url,
				)
			if (!m) throw new Error(`Bad ${RASTER_PROTOCOL_NAME} URL: ${req.url}`)
			const [, osmId, sizeStr, zStr, xStr, yStr] = m

			const tileSize = +sizeStr
			const tileIndex: Tile = [+xStr, +yStr, +zStr]
			const rasterTile = await osmWorker.getRasterTile(
				decodeURIComponent(osmId),
				tileIndex,
				{tileSize},
			)
			const data = await rasterTileToImageBuffer(rasterTile, tileSize)
			return {
				data,
				cacheControl: "no-store",
			}
		},
	)
}

export function removeOsmixRasterProtocol() {
	maplibre.removeProtocol(RASTER_PROTOCOL_NAME)
}

/**
 * Converts an RGBA array to an image buffer using the OffscreenCanvas API.
 * This is the standard browser-native approach and requires no external dependencies.
 */
export async function rasterTileToImageBuffer(
	imageData: Uint8ClampedArray<ArrayBuffer>,
	tileSize: number,
	options: ImageEncodeOptions = { type: "image/png" },
) {
	const canvas = new OffscreenCanvas(tileSize, tileSize)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Failed to get 2d context from OffscreenCanvas")
	ctx.putImageData(new ImageData(imageData, tileSize, tileSize), 0, 0)
	const blob = await canvas.convertToBlob(options)
	return await blob.arrayBuffer()
}
