import { clipPolyline } from "@osmix/shared/lineclip"
import SphericalMercatorTile from "@osmix/shared/spherical-mercator"
import type { LonLat, Rgba, Tile, XY } from "@osmix/shared/types"

export const DEFAULT_RASTER_IMAGE_TYPE = "image/png"
export const DEFAULT_WAY_COLOR: Rgba = [255, 255, 255, 255] // white
export const DEFAULT_NODE_COLOR: Rgba = [255, 0, 0, 255] // red
export const DEFAULT_RASTER_TILE_SIZE = 256

export class OsmixRasterTile {
	imageData: Uint8ClampedArray<ArrayBuffer>
	proj: SphericalMercatorTile

	constructor(tile: Tile, tileSize: number = DEFAULT_RASTER_TILE_SIZE) {
		this.imageData = new Uint8ClampedArray(tileSize * tileSize * 4)
		this.proj = new SphericalMercatorTile({ size: tileSize, tile })
	}

	getIndex(px: XY) {
		return (px[1] * this.proj.tileSize + px[0]) * 4
	}

	setLonLat(ll: LonLat, color: Rgba = DEFAULT_NODE_COLOR) {
		const px = this.proj.llToTilePx(ll)
		this.setPixel(px, color)
	}

	setPixel(px: XY, color: Rgba) {
		const clampedPx = this.proj.clampAndRoundPx(px)
		const idx = this.getIndex(clampedPx)
		this.imageData[idx] = color[0]
		this.imageData[idx + 1] = color[1]
		this.imageData[idx + 2] = color[2]
		this.imageData[idx + 3] = color[3]
	}

	drawLine(px0: XY, px1: XY, color: Rgba = DEFAULT_WAY_COLOR) {
		const dx = Math.abs(px1[0] - px0[0])
		const dy = Math.abs(px1[1] - px0[1])
		const sx = px0[0] < px1[0] ? 1 : -1
		const sy = px0[1] < px1[1] ? 1 : -1
		let err = dx - dy
		let x = px0[0]
		let y = px0[1]

		while (true) {
			const idx = this.getIndex([x, y])
			this.imageData[idx] = color[0]
			this.imageData[idx + 1] = color[1]
			this.imageData[idx + 2] = color[2]
			this.imageData[idx + 3] = color[3]
			if (x === px1[0] && y === px1[1]) break
			const e2 = 2 * err
			if (e2 > -dy) {
				err -= dy
				x += sx
			}
			if (e2 < dx) {
				err += dx
				y += sy
			}
		}
	}

	drawWay(way: LonLat[], color: Rgba = DEFAULT_WAY_COLOR) {
		const projectedWay = way.map((ll) => this.proj.llToTilePx(ll))
		const [clipped] = clipPolyline(projectedWay, [
			0,
			0,
			this.proj.tileSize,
			this.proj.tileSize,
		])
		if (clipped != null) {
			let prev: XY = clipped[0] as XY
			for (const curr of clipped) {
				if (prev == null) {
					prev = curr
					return
				}
				const px0 = this.proj.clampAndRoundPx(prev)
				const px1 = this.proj.clampAndRoundPx(curr)
				if (px0[0] !== px1[0] || px0[1] !== px1[1]) {
					this.drawLine(px0, px1, color)
				}
				prev = curr
			}
		}
	}
}
