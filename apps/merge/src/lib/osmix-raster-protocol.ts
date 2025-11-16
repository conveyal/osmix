import {
	createOsmixRasterMaplibreProtocol,
	RASTER_PROTOCOL_NAME,
} from "@osmix/raster"
import maplibre from "maplibre-gl"
import { osmWorker } from "../state/worker"

export function addOsmixRasterProtocol() {
	maplibre.addProtocol(
		RASTER_PROTOCOL_NAME,
		createOsmixRasterMaplibreProtocol(async (osmId, tileIndex, tileSize) => {
			const buffer = await osmWorker.getRasterTile(osmId, tileIndex, tileSize)
			return rasterTileToImageBuffer(new Uint8ClampedArray(buffer), tileSize)
		}),
	)
}

export function removeOsmixRasterProtocol() {
	maplibre.removeProtocol(RASTER_PROTOCOL_NAME)
}

/**
 * Example of how to convert a raster tile to an image buffer using the OffscreenCanvas API.
 */
export async function rasterTileToImageBuffer(
	imageData: Uint8ClampedArray<ArrayBuffer>,
	tileSize: number,
	options: ImageEncodeOptions = { type: "image/png" },
) {
	const canvas = new OffscreenCanvas(tileSize, tileSize)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw Error("Failed to get context")
	ctx.putImageData(new ImageData(imageData, tileSize, tileSize), 0, 0)
	const blob = await canvas.convertToBlob(options)
	const data = await blob.arrayBuffer()
	return data
}
