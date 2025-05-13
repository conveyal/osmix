import { SphericalMercator } from "@mapbox/sphericalmercator"
import type { GeoBbox2D, LonLat, Tile, XY } from "./types"

/**
 * Extends the SphericalMercator class to provide tile-local pixel coordinate calculations and clamping.
 */
export default class SphericalMercatorTile extends SphericalMercator {
	tileSize: number
	tile?: Tile
	constructor(
		options: ConstructorParameters<typeof SphericalMercator>[0] & {
			tile?: Tile
		},
	) {
		super(options)
		this.tile = options?.tile
		this.tileSize = options?.size ?? 256
	}

	llToTilePx(ll: LonLat, tile?: Tile): XY {
		if (tile == null && this.tile == null)
			throw Error("Tile must be set on construction or passed as an argument.")
		const [tx, ty, tz] = (tile ?? this.tile)!
		const merc = this.px(ll, tz)
		const x = merc[0] - tx * this.tileSize
		const y = merc[1] - ty * this.tileSize
		return [x, y]
	}

	clampAndRoundPx(px: XY, bbox?: GeoBbox2D): XY {
		const [minX, minY, maxX, maxY] = bbox ?? [
			0,
			0,
			this.tileSize,
			this.tileSize,
		]
		return [
			Math.max(minX, Math.min(maxX, Math.round(px[0]))),
			Math.max(minY, Math.min(maxY, Math.round(px[1]))),
		]
	}
}
