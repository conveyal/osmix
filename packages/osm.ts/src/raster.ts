import type { GeoBbox2D } from "./types"

export function lonLatToPixel(
	lon: number,
	lat: number,
	[minLon, minLat, maxLon, maxLat]: GeoBbox2D,
	size = 512,
): [number, number] {
	// linear interpolation
	const x = ((lon - minLon) / (maxLon - minLon)) * (size - 1)
	const y = ((maxLat - lat) / (maxLat - minLat)) * (size - 1) // y down
	return [
		Math.round(Math.max(0, Math.min(size - 1, x))),
		Math.round(Math.max(0, Math.min(size - 1, y))),
	]
}

const TILE_EPS = 1e-12

type Rgba = [number, number, number, number]

/**
 * Blend two RGBA colors.
 * - If `a` is fully transparent, return `b`.
 * - Alpha blending uses proper source-over compositing
 * - `a` is drawn over `b`
 * - Returns fully opaque result if either is opaque
 */
function blendRgba([rA, gA, bA, aA255]: Rgba, [rB, gB, bB, aB255]: Rgba): Rgba {
	const aA = aA255 / 255
	const aB = aB255 / 255

	const outA = aA + aB * (1 - aA)
	const outA255 = outA * 255

	const blendChannel = (cA: number, cB: number) =>
		outA === 0 ? 0 : Math.round((cA * aA + cB * aB * (1 - aA)) / outA)

	const outR = blendChannel(rA, rB)
	const outG = blendChannel(gA, gB)
	const outB_ = blendChannel(bA, bB)

	return [outR, outG, outB_, Math.round(outA255)]
}

/**
 * Clip a geographic line segment [lon0,lat0]→[lon1,lat1] to the given bbox using Liang–Barsky.
 * We treat the RIGHT/TOP edges as *exclusive* (half-open box) to avoid double-drawing seams
 * between adjacent tiles. This is done by shrinking maxLon/maxLat by a tiny epsilon.
 * Returns null if the segment does not intersect the bbox.
 */
function clipSegmentToBbox(
	lon0: number,
	lat0: number,
	lon1: number,
	lat1: number,
	bbox: GeoBbox2D,
): [number, number, number, number] | null {
	let [minLon, minLat, maxLon, maxLat] = bbox
	// Make right/top edges exclusive to prevent seam lines across tiles
	maxLon -= TILE_EPS
	maxLat -= TILE_EPS

	const dx = lon1 - lon0
	const dy = lat1 - lat0

	// p and q arrays per Liang–Barsky
	const p = [-dx, dx, -dy, dy]
	const q = [lon0 - minLon, maxLon - lon0, lat0 - minLat, maxLat - lat0]

	let u1 = 0
	let u2 = 1

	for (let i = 0; i < 4; i++) {
		const pi = p[i]
		const qi = q[i]
		if (pi === 0) {
			// Segment is parallel to this boundary; reject if outside
			if (qi < 0) return null
		} else {
			const r = qi / pi
			if (pi < 0) {
				if (r > u2) return null
				if (r > u1) u1 = r
			} else {
				// pi > 0
				if (r < u1) return null
				if (r < u2) u2 = r
			}
		}
	}

	const cx0 = lon0 + u1 * dx
	const cy0 = lat0 + u1 * dy
	const cx1 = lon0 + u2 * dx
	const cy1 = lat0 + u2 * dy
	return [cx0, cy0, cx1, cy1]
}

export class Bitmap {
	bbox: GeoBbox2D
	data: Uint8ClampedArray
	tileSize: number

	constructor(bbox: GeoBbox2D, tileSize: number) {
		this.bbox = bbox
		this.tileSize = tileSize
		this.data = new Uint8ClampedArray(tileSize * tileSize * 4)
	}

	lonLatToPixel(lon: number, lat: number) {
		return lonLatToPixel(lon, lat, this.bbox, this.tileSize)
	}

	setLonLat(lon: number, lat: number, color?: Rgba) {
		const [x, y] = this.lonLatToPixel(lon, lat)
		this.setPixel(x, y, color)
	}

	blendPixel(x: number, y: number, color: Rgba) {
		if (x < 0 || x >= this.tileSize || y < 0 || y >= this.tileSize) return
		const idx = (y * this.tileSize + x) * 4
		const [r, g, b, a] = [
			this.data[idx],
			this.data[idx + 1],
			this.data[idx + 2],
			this.data[idx + 3],
		]
		this.data.set(blendRgba([r, g, b, a], color), idx)
	}

	setPixel(x: number, y: number, color: Rgba = [255, 255, 255, 254]) {
		if (x < 0 || x >= this.tileSize || y < 0 || y >= this.tileSize) return
		const idx = (y * this.tileSize + x) * 4
		this.data[idx] = color[0]
		this.data[idx + 1] = color[1]
		this.data[idx + 2] = color[2]
		this.data[idx + 3] = color[3]
	}

	drawLine(x0: number, y0: number, x1: number, y1: number) {
		const dx = Math.abs(x1 - x0)
		const dy = Math.abs(y1 - y0)
		const sx = x0 < x1 ? 1 : -1
		const sy = y0 < y1 ? 1 : -1
		let err = dx - dy
		let x = x0
		let y = y0

		while (true) {
			this.setPixel(x, y)
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

	drawWay(positions: Float64Array) {
		let lonPrev = positions[0]
		let latPrev = positions[1]
		for (let p = 2; p < positions.length; p += 2) {
			const lonCurr = positions[p]
			const latCurr = positions[p + 1]
			const clipped = clipSegmentToBbox(
				lonPrev,
				latPrev,
				lonCurr,
				latCurr,
				this.bbox,
			)
			if (clipped) {
				const [cl0lon, cl0lat, cl1lon, cl1lat] = clipped
				const [x0, y0] = this.lonLatToPixel(cl0lon, cl0lat)
				const [x1, y1] = this.lonLatToPixel(cl1lon, cl1lat)
				if (x0 !== x1 || y0 !== y1) {
					this.drawLine(x0, y0, x1, y1)
				}
			}

			lonPrev = lonCurr
			latPrev = latCurr
		}
	}
}
