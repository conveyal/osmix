/**
 * Example of how to convert a raster tile to an image buffer using the OffscreenCanvas API.
 */

import type { OsmixRasterTile } from "@osmix/raster"

export function rasterTileToCanvas(tile: OsmixRasterTile) {
	const { tileSize } = tile.proj
	const canvas = new OffscreenCanvas(tileSize, tileSize)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw Error("Failed to get context")
	ctx.putImageData(new ImageData(tile.imageData, tileSize, tileSize), 0, 0)
	return canvas
}

export async function rasterTileToImageBuffer(
	tile: OsmixRasterTile,
	options: ImageEncodeOptions = { type: "image/png" },
) {
	const canvas = rasterTileToCanvas(tile)
	const blob = await canvas.convertToBlob(options)
	return blob.arrayBuffer()
}
