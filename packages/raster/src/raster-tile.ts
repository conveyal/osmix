import { SphericalMercator } from "@mapbox/sphericalmercator"
import type { GeoBbox2D } from "@osmix/json"
import { clipPolyline } from "@osmix/shared/lineclip"
import type { LonLat, Rgba, Tile, XY } from "@osmix/shared/types"

/**
 * TODO remove spherical mercator dependency here pass in projection function instead
 */
export type LonLatToPixel = (
	ll: [lon: number, lat: number],
	zoom: number,
) => [x: number, y: number]

export const DEFAULT_RASTER_IMAGE_TYPE = "image/png"
export const DEFAULT_WAY_COLOR: Rgba = [255, 255, 255, 255] // white
export const DEFAULT_NODE_COLOR: Rgba = [255, 0, 0, 255] // red
export const DEFAULT_RASTER_TILE_SIZE = 256

export class OsmixRasterTile {
	bbox: GeoBbox2D
	imageData: Uint8ClampedArray<ArrayBuffer>
	tileSize: number
	tile: Tile
	merc: SphericalMercator

	constructor(
		bbox: GeoBbox2D,
		tile: Tile,
		tileSize: number = DEFAULT_RASTER_TILE_SIZE,
	) {
		this.bbox = bbox
		this.tileSize = tileSize
		this.imageData = new Uint8ClampedArray(tileSize * tileSize * 4)
		this.tile = tile
		this.merc = new SphericalMercator({ size: tileSize })
	}

	lonLatToTilePixel(ll: LonLat): XY {
		const merc = this.merc.px(ll, this.tile[2])

		// Convert to local tile pixel
		const x = Math.floor(merc[0]) - this.tile[0] * this.tileSize
		const y = Math.floor(merc[1]) - this.tile[1] * this.tileSize

		// Clamp to tile bounds
		return [
			Math.max(0, Math.min(this.tileSize - 1, x)),
			Math.max(0, Math.min(this.tileSize - 1, y)),
		]
	}

	setLonLat(ll: LonLat, color: Rgba = DEFAULT_NODE_COLOR) {
		const px = this.lonLatToTilePixel(ll)
		this.setPixel(px, color)
	}

	setPixel(px: XY, color: Rgba) {
		if (
			px[0] < 0 ||
			px[0] >= this.tileSize ||
			px[1] < 0 ||
			px[1] >= this.tileSize
		)
			return
		const idx = (px[1] * this.tileSize + px[0]) * 4
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
			const idx = (y * this.tileSize + x) * 4
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
		const [clipped] = clipPolyline(way, this.bbox)
		if (clipped != null) {
			let prev: LonLat = clipped[0] as LonLat
			for (const curr of clipped) {
				if (prev == null) {
					prev = curr
					return
				}
				const px0 = this.lonLatToTilePixel(prev)
				const px1 = this.lonLatToTilePixel(curr)
				if (px0[0] !== px1[0] || px0[1] !== px1[1]) {
					this.drawLine(px0, px1, color)
				}
				prev = curr
			}
		}
	}
}
