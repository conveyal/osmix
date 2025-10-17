import { SphericalMercator } from "@mapbox/sphericalmercator"
import type { GeoBbox2D } from "@osmix/json"
import { clipPolyline } from "@osmix/shared"

export type Rgba = [number, number, number, number] | Uint8ClampedArray

export interface TileIndex {
	z: number
	x: number
	y: number
}

export const DEFAULT_RASTER_IMAGE_TYPE = "image/png"
export const DEFAULT_WAY_COLOR: Rgba = [255, 255, 255, 255] // white
export const DEFAULT_NODE_COLOR: Rgba = [255, 0, 0, 255] // red
export const DEFAULT_TILE_SIZE = 256

export class OsmixRasterTile {
	bbox: GeoBbox2D
	imageData: Uint8ClampedArray<ArrayBuffer>
	tileSize: number
	tileIndex: TileIndex
	merc: SphericalMercator

	constructor(
		bbox: GeoBbox2D,
		tileIndex: TileIndex,
		tileSize: number = DEFAULT_TILE_SIZE,
	) {
		this.bbox = bbox
		this.tileSize = tileSize
		this.imageData = new Uint8ClampedArray(tileSize * tileSize * 4)
		this.tileIndex = tileIndex
		this.merc = new SphericalMercator({ size: tileSize })
	}

	lonLatToPixel(ll: [number, number]): [number, number] {
		const merc = this.merc.px(ll, this.tileIndex.z)

		// Convert to local tile pixel
		const x = Math.floor(merc[0]) - this.tileIndex.x * this.tileSize
		const y = Math.floor(merc[1]) - this.tileIndex.y * this.tileSize

		// Clamp to tile bounds
		return [
			Math.max(0, Math.min(this.tileSize - 1, x)),
			Math.max(0, Math.min(this.tileSize - 1, y)),
		]
	}

	setLonLat([lon, lat]: [number, number], color: Rgba = DEFAULT_NODE_COLOR) {
		const px = this.lonLatToPixel([lon, lat])
		this.setPixel(px, color)
	}

	setPixel(px: [number, number], color: Rgba) {
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

	drawLine(
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		color: Rgba = DEFAULT_WAY_COLOR,
	) {
		const dx = Math.abs(x1 - x0)
		const dy = Math.abs(y1 - y0)
		const sx = x0 < x1 ? 1 : -1
		const sy = y0 < y1 ? 1 : -1
		let err = dx - dy
		let x = x0
		let y = y0

		while (true) {
			const idx = (y * this.tileSize + x) * 4
			this.imageData[idx] = color[0]
			this.imageData[idx + 1] = color[1]
			this.imageData[idx + 2] = color[2]
			this.imageData[idx + 3] = color[3]
			if (x === x1 && y === y1) break
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

	drawWay(way: [number, number][], color: Rgba = DEFAULT_WAY_COLOR) {
		const result = clipPolyline(way, this.bbox)
		if (result && result.length > 0) {
			const [clipped] = result
			let prev = clipped[0]
			for (let i = 1; i < clipped.length; i++) {
				const curr = clipped[i]
				const [x0, y0] = this.lonLatToPixel(prev)
				const [x1, y1] = this.lonLatToPixel(curr)
				if (x0 !== x1 || y0 !== y1) {
					this.drawLine(x0, y0, x1, y1, color)
				}
				prev = curr
			}
		}
	}

	toCanvas() {
		const canvas = new OffscreenCanvas(this.tileSize, this.tileSize)
		const ctx = canvas.getContext("2d")
		if (!ctx) throw Error("Failed to get context")
		ctx.putImageData(
			new ImageData(this.imageData, this.tileSize, this.tileSize),
			0,
			0,
		)
		return canvas
	}

	async toImageBuffer(
		options: ImageEncodeOptions = { type: DEFAULT_RASTER_IMAGE_TYPE },
	) {
		const canvas = this.toCanvas()
		const blob = await canvas.convertToBlob(options)
		return blob.arrayBuffer()
	}
}
