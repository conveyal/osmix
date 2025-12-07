import { pointToTileFraction } from "@mapbox/tilebelt"
import type { GeoBbox2D, LonLat, Tile, TilePxBbox, XY } from "./types"

const RADIANS_TO_DEGREES = 180 / Math.PI

function tile2lon(x: number, z: number): number {
	return (x / 2 ** z) * 360 - 180
}

function tile2lat(y: number, z: number): number {
	const n = Math.PI - (2 * Math.PI * y) / 2 ** z
	return RADIANS_TO_DEGREES * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/**
 * Get the geographic bounding box of a tile.
 * Returns [west, south, east, north].
 */
export function tileToBbox(tile: Tile): GeoBbox2D {
	const [tx, ty, tz] = tile
	const n = tile2lat(ty, tz)
	const s = tile2lat(ty + 1, tz)
	const e = tile2lon(tx + 1, tz)
	const w = tile2lon(tx, tz)
	return [w, s, e, n]
}

/**
 * Convert a bounding box from geographic coordinates to tile pixel coordinates.
 */
export function bboxToTilePx(
	bbox: GeoBbox2D,
	tile: Tile,
	tileSize = 256,
): TilePxBbox {
	const [minX, minY] = llToTilePx([bbox[0], bbox[3]], tile, tileSize)
	const [maxX, maxY] = llToTilePx([bbox[2], bbox[1]], tile, tileSize)
	return [minX, minY, maxX, maxY]
}

/**
 * Convert a geographic coordinate to tile pixel coordinates.
 * Returns [x, y] in pixels relative to the top-left of the tile.
 */
export function llToTilePx(ll: LonLat, tile: Tile, tileSize = 256): XY {
	const [tx, ty, tz] = tile
	const tf = pointToTileFraction(ll[0], ll[1], tz)
	const x = (tf[0] - tx) * tileSize
	const y = (tf[1] - ty) * tileSize
	return [x, y]
}

/**
 * Convert tile pixel coordinates to geographic coordinates.
 */
export function tilePxToLonLat(px: XY, tile: Tile, tileSize = 256): LonLat {
	const [tx, ty, tz] = tile
	const lon = tile2lon(px[0] / tileSize + tx, tz)
	const lat = tile2lat(px[1] / tileSize + ty, tz)
	return [lon, lat]
}

/**
 * Clamp a pixel coordinate to the tile bounds and round to the nearest integer. Useful for converting a floating point pixel
 * coordinate to a the exact tile pixel it is contained by.
 */
export function clampAndRoundPx(
	px: XY,
	tileSizeOrBbox: number | GeoBbox2D,
): XY {
	const [minX, minY, maxX, maxY] =
		typeof tileSizeOrBbox === "number"
			? [0, 0, tileSizeOrBbox, tileSizeOrBbox]
			: tileSizeOrBbox
	return [
		Math.max(minX, Math.min(maxX, Math.round(px[0]))),
		Math.max(minY, Math.min(maxY, Math.round(px[1]))),
	]
}
