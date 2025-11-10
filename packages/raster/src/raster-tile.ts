import rewind from "@osmix/shared/geojson-rewind"
import { clipPolygon, clipPolyline } from "@osmix/shared/lineclip"
import SphericalMercatorTile from "@osmix/shared/spherical-mercator"
import type { LonLat, Rgba, Tile, XY } from "@osmix/shared/types"
import { compositeRGBA } from "./color"

export const DEFAULT_RASTER_IMAGE_TYPE = "image/png"
export const DEFAULT_LINE_COLOR: Rgba = [255, 255, 255, 230] // semi-transparent white
export const DEFAULT_POINT_COLOR: Rgba = [255, 0, 0, 255] // red
export const DEFAULT_AREA_COLOR: Rgba = [0, 0, 255, 64] // low opacity blue
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

	setLonLat(ll: LonLat, color: Rgba = DEFAULT_POINT_COLOR) {
		const px = this.proj.llToTilePx(ll)
		this.setPixel(px, color)
	}

	setPixel(px: XY, color: Rgba) {
		const clampedPx = this.proj.clampAndRoundPx(px)
		const idx = this.getIndex(clampedPx)
		if (this.imageData[idx + 3] === 0) {
			this.imageData[idx] = color[0]
			this.imageData[idx + 1] = color[1]
			this.imageData[idx + 2] = color[2]
			this.imageData[idx + 3] = color[3]
		} else {
			const composite = compositeRGBA([
				this.imageData.slice(idx, idx + 4),
				color,
			])
			this.imageData[idx] = composite[0]
			this.imageData[idx + 1] = composite[1]
			this.imageData[idx + 2] = composite[2]
			this.imageData[idx + 3] = composite[3]
		}
	}

	drawLine(px0: XY, px1: XY, color: Rgba = DEFAULT_LINE_COLOR) {
		const tileSize = this.proj.tileSize
		const dx = Math.abs(px1[0] - px0[0])
		const dy = Math.abs(px1[1] - px0[1])
		const sx = px0[0] < px1[0] ? 1 : -1
		const sy = px0[1] < px1[1] ? 1 : -1
		let err = dx - dy
		let x = px0[0]
		let y = px0[1]

		while (true) {
			// Only draw pixels within tile bounds
			if (x >= 0 && x < tileSize && y >= 0 && y < tileSize) {
				const idx = this.getIndex([x, y])
				this.imageData[idx] = color[0]
				this.imageData[idx + 1] = color[1]
				this.imageData[idx + 2] = color[2]
				this.imageData[idx + 3] = color[3]
			}
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

	drawLineString(coords: LonLat[], color: Rgba = DEFAULT_LINE_COLOR) {
		const projectedCoords = coords.map((ll) => this.proj.llToTilePx(ll))
		const [clipped] = clipPolyline(projectedCoords, [
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

	/**
	 * Draw a filled polygon with optional holes.
	 * First ring is the outer boundary, subsequent rings are holes.
	 * Uses even-odd winding rule for fill determination.
	 */
	drawPolygon(rings: LonLat[][], color: Rgba = DEFAULT_AREA_COLOR) {
		if (rings.length === 0) return

		// Normalize winding order using rewind (outer counterclockwise, inner clockwise)
		const normalizedRings = rings.map((ring) => {
			const feature = {
				type: "Feature" as const,
				geometry: {
					type: "Polygon" as const,
					coordinates: [ring],
				},
			}
			const rewound = rewind(feature, false)
			const firstRing = rewound.geometry.coordinates[0]
			if (!firstRing) return ring
			return firstRing
		})

		// Project and clip all rings
		const tileBbox: [number, number, number, number] = [
			0,
			0,
			this.proj.tileSize,
			this.proj.tileSize,
		]
		const clippedRings: XY[][] = []
		for (const ring of normalizedRings) {
			const projected = ring.map((ll) => this.proj.llToTilePx(ll))
			const clipped = clipPolygon(projected, tileBbox)
			if (clipped.length >= 3) {
				// Ensure ring is closed
				const first = clipped[0]
				const last = clipped[clipped.length - 1]
				if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
					clipped.push([first[0], first[1]])
				}
				clippedRings.push(clipped.map((xy) => this.proj.clampAndRoundPx(xy)))
			}
		}

		if (clippedRings.length === 0) return

		// Use scanline fill algorithm with even-odd rule
		this.fillPolygonScanline(clippedRings, color)
	}

	/**
	 * Draw a MultiPolygon (multiple polygons, each with optional holes).
	 */
	drawMultiPolygon(polygons: LonLat[][][], color: Rgba = DEFAULT_AREA_COLOR) {
		for (const polygon of polygons) {
			this.drawPolygon(polygon, color)
		}
	}

	/**
	 * Draw a relation as polygon(s).
	 * Takes an array of polygons (each polygon is an array of rings: [outer, ...inner]).
	 */
	drawRelation(polygons: LonLat[][][], color: Rgba = DEFAULT_AREA_COLOR) {
		this.drawMultiPolygon(polygons, color)
	}

	/**
	 * Fill polygon using scanline algorithm with even-odd winding rule.
	 * Handles holes correctly by toggling fill state on each edge crossing.
	 */
	private fillPolygonScanline(rings: XY[][], color: Rgba) {
		const tileSize = this.proj.tileSize
		const outerRing = rings[0]
		if (!outerRing || outerRing.length < 3) return

		// Build edge list for all rings
		const edges: Array<{ y0: number; y1: number; x0: number; x1: number }> = []
		for (const ring of rings) {
			for (let i = 0; i < ring.length - 1; i++) {
				const p0 = ring[i]
				const p1 = ring[i + 1]
				if (!p0 || !p1) continue

				// Only add horizontal edges (for scanline)
				if (p0[1] !== p1[1]) {
					edges.push({
						y0: Math.min(p0[1], p1[1]),
						y1: Math.max(p0[1], p1[1]),
						x0: p0[0],
						x1: p1[0],
					})
				}
			}
		}

		// Find y bounds
		let minY = tileSize
		let maxY = 0
		for (const ring of rings) {
			for (const [, y] of ring) {
				if (y < minY) minY = Math.max(0, y)
				if (y > maxY) maxY = Math.min(tileSize - 1, y)
			}
		}

		// Scanline fill
		// Skip top and bottom boundary rows (y=0 and y=tileSize-1) to avoid edge artifacts
		for (let y = minY; y <= maxY; y++) {
			// Skip boundary rows to prevent edge artifacts
			if (y === 0 || y === tileSize - 1) {
				continue
			}

			const intersections: number[] = []

			// Find all x intersections at this y
			for (const ring of rings) {
				for (let i = 0; i < ring.length - 1; i++) {
					const p0 = ring[i]
					const p1 = ring[i + 1]
					if (!p0 || !p1) continue

					// Check if edge crosses this scanline
					const [x0, y0] = p0
					const [x1, y1] = p1
					if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) {
						// Calculate x intersection
						const dx = x1 - x0
						const dy = y1 - y0
						if (dy !== 0) {
							const x = x0 + ((y - y0) * dx) / dy
							intersections.push(Math.round(x))
						}
					}
				}
			}

			// Sort intersections
			intersections.sort((a, b) => a - b)

			// Fill between pairs (even-odd rule)
			// Skip boundary pixels (x=0 and x=tileSize-1) to avoid edge artifacts
			// when tiles are rendered side-by-side. This ensures adjacent tiles don't have
			// overlapping pixels at their boundaries.
			for (let i = 0; i < intersections.length - 1; i += 2) {
				const rawX0 = intersections[i]!
				const rawX1 = intersections[i + 1]!

				// Clamp intersections to tile bounds
				const x0 = Math.max(0, Math.min(tileSize - 1, rawX0))
				const x1 = Math.max(0, Math.min(tileSize - 1, rawX1))

				// Fill the range, but skip boundary pixels
				for (let x = x0; x <= x1; x++) {
					// Skip boundary pixels to prevent edge artifacts
					if (x === 0 || x === tileSize - 1) {
						continue
					}
					this.setPixel([x, y], color)
				}
			}
		}
	}
}
