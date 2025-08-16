import { APPID, BITMAP_TILE_SIZE, MIN_PICKABLE_ZOOM } from "@/settings"
import { mapAtom } from "@/state/map"
import { useAtomValue } from "jotai"
import type { GeoBbox2D, Osm } from "osm.ts"
import { useEffect, useMemo } from "react"
import { useOsmWorker } from "./osm"
import { COORDINATE_SYSTEM, type Layer as DeckGlLayer } from "@deck.gl/core"
import { TileLayer, type GeoBoundingBox } from "@deck.gl/geo-layers"
import { BitmapLayer } from "@deck.gl/layers"

export function useFitBoundsOnChange(bbox?: GeoBbox2D) {
	const map = useAtomValue(mapAtom)

	useEffect(() => {
		if (!map || !bbox) return
		map.fitBounds(bbox, {
			padding: 100,
			maxDuration: 200,
		})
	}, [bbox, map])
}

const EMPTY_BITMAP = new Uint8Array(BITMAP_TILE_SIZE * BITMAP_TILE_SIZE * 4)

export function useBitmapTileLayer(osm?: Osm | null) {
	const osmWorker = useOsmWorker()
	return useMemo(() => {
		const bbox = osm?.bbox()
		const osmId = osm?.id
		if (!osmWorker || !osm || !osmId || !bbox) return null
		const idPrefix = `${APPID}:${osmId}:tiles`
		return new TileLayer<Awaited<
			ReturnType<typeof osmWorker.getTileBitmap>
		> | null>({
			id: idPrefix,
			extent: bbox,
			getTileData: async (tile) => {
				const bbox = tile.bbox as GeoBoundingBox
				const data = await osmWorker.getTileBitmap(
					osmId,
					[bbox.west, bbox.south, bbox.east, bbox.north],
					tile.index,
					BITMAP_TILE_SIZE,
				)
				return data
			},
			renderSubLayers: (props) => {
				const { tile, data } = props
				if (!data) return null
				const { x, y, z } = tile.index
				const tilePrefix = `${idPrefix}:${z}/${x}/${y}`
				const layers: DeckGlLayer[] = []
				const tileBbox = tile.bbox as GeoBoundingBox

				if ("bitmap" in data) {
					layers.push(
						new BitmapLayer({
							id: `${tilePrefix}:bitmap`,
							_imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
							bounds: [
								tileBbox.west,
								tileBbox.south,
								tileBbox.east,
								tileBbox.north,
							],
							image: {
								data: data.bitmap ?? EMPTY_BITMAP,
								width: BITMAP_TILE_SIZE,
								height: BITMAP_TILE_SIZE,
							},
						}),
					)
				}
				return layers
			},
		})
	}, [osm, osmWorker])
}
