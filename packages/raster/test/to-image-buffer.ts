/**
 * Example of how to convert a raster tile to an image buffer using the OffscreenCanvas API.
 */

import type { OsmixRasterTile } from "../src/raster-tile"

export function rasterTileToCanvas(tile: OsmixRasterTile) {
	const canvas = new OffscreenCanvas(tile.tileSize, tile.tileSize)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw Error("Failed to get context")
	ctx.putImageData(
		new ImageData(tile.imageData, tile.tileSize, tile.tileSize),
		0,
		0,
	)
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
