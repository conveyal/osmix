import { describe, expect, it } from "vitest"
import SphericalMercatorTile from "./spherical-mercator"
import type { Tile } from "./types"

function lonLatForPixel(
	merc: SphericalMercatorTile,
	tileIndex: Tile,
	tileSize: number,
	px: number,
	py: number,
): [number, number] {
	const [x, y, z] = tileIndex
	return merc.ll([x * tileSize + px, y * tileSize + py], z) as [number, number]
}

describe("SphericalMercatorTile", () => {
	it("projects lon/lat to tile-local pixels", () => {
		const tile: Tile = [300, 300, 10]
		const [tx, ty, tz] = tile
		const tileSize = 256
		const merc = new SphericalMercatorTile({ size: tileSize, tile })

		const insideLonLat = lonLatForPixel(merc, tile, tileSize, 32, 16)
		expect(merc.llToTilePx(insideLonLat)).toEqual([32, 16])

		const outsideTopLeft = merc.ll(
			[tx * tileSize - 10, ty * tileSize - 10],
			tz,
		) as [number, number]
		expect(outsideTopLeft).toEqual([-74.54498291015625, 59.54128017205441])
		expect(merc.llToTilePx(outsideTopLeft)).toEqual([-10, -10])

		const outsideBottomRight = merc.ll(
			[(tx + 1) * tileSize + 10, (ty + 1) * tileSize + 10],
			tz,
		) as [number, number]
		expect(merc.llToTilePx(outsideBottomRight, tile)).toEqual([
			tileSize + 10,
			tileSize + 10,
		])
	})
})
