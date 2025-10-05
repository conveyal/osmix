import { SphericalMercator } from "@mapbox/sphericalmercator"
import { clipPolyline } from "lineclip"
import type { Osmix } from "./osmix"
import type { GeoBbox2D, Rgba, TileIndex } from "./types"

const DEFAULT_COLOR: Rgba = [255, 255, 255, 255] // white

export class OsmixRasterTile {
	osm: Osmix
	bbox: GeoBbox2D
	imageData: Uint8ClampedArray<ArrayBuffer>
	tileSize: number
	tileIndex: TileIndex
	merc: SphericalMercator

	constructor(
		osm: Osmix,
		bbox: GeoBbox2D,
		tileIndex: TileIndex,
		tileSize: number,
	) {
		this.osm = osm
		this.bbox = bbox
		this.tileSize = tileSize
		this.imageData = new Uint8ClampedArray(tileSize * tileSize * 4)
		this.tileIndex = tileIndex
		this.merc = new SphericalMercator({ size: tileSize })
	}

	lonLatToPixel(lon: number, lat: number) {
		const merc = this.merc.px([lon, lat], this.tileIndex.z)

		// Convert to local tile pixel
		const x = Math.floor(merc[0]) - this.tileIndex.x * this.tileSize
		const y = Math.floor(merc[1]) - this.tileIndex.y * this.tileSize

		// Clamp to tile bounds
		return [
			Math.max(0, Math.min(this.tileSize - 1, x)),
			Math.max(0, Math.min(this.tileSize - 1, y)),
		]
	}

	setLonLat(lon: number, lat: number, color?: Rgba) {
		const [x, y] = this.lonLatToPixel(lon, lat)
		this.setPixel(x, y, color)
	}

	setPixel(x: number, y: number, color: Rgba = DEFAULT_COLOR) {
		if (x < 0 || x >= this.tileSize || y < 0 || y >= this.tileSize) return
		const idx = (y * this.tileSize + x) * 4
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
		color: Rgba = DEFAULT_COLOR,
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

	drawWay(way: [number, number][]) {
		const result = clipPolyline(way, this.bbox)
		if (result && result.length > 0) {
			const [clipped] = result
			let prev = clipped[0]
			for (let i = 1; i < clipped.length; i++) {
				const curr = clipped[i]
				const [x0, y0] = this.lonLatToPixel(prev[0], prev[1])
				const [x1, y1] = this.lonLatToPixel(curr[0], curr[1])
				if (x0 !== x1 || y0 !== y1) {
					this.drawLine(x0, y0, x1, y1)
				}
				prev = curr
			}
		}
	}

	drawWays() {
		const timer = `OsmixRasterTile.drawWays:${this.tileIndex.z}/${this.tileIndex.x}/${this.tileIndex.y}`
		console.time(timer)
		this.osm.ways.intersects(this.bbox, (wayIndex) => {
			this.drawWay(this.osm.ways.getCoordinates(wayIndex, this.osm.nodes))
			return false
		})
		console.timeEnd(timer)
	}

	drawNodes() {
		const timer = `OsmixRasterTile.drawNodes:${this.tileIndex.z}/${this.tileIndex.x}/${this.tileIndex.y}`
		console.time(timer)
		const nodeCandidates = this.osm.nodes.withinBbox(this.bbox)

		for (const nodeIndex of nodeCandidates) {
			if (!this.osm.nodes.tags.hasTags(nodeIndex)) continue
			const [lon, lat] = this.osm.nodes.getNodeLonLat({ index: nodeIndex })
			this.setLonLat(lon, lat, [255, 0, 0, 255])
		}
		console.timeEnd(timer)
	}
}
