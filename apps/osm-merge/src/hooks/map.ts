import { APPID, BITMAP_TILE_SIZE, MIN_PICKABLE_ZOOM } from "@/settings"
import { mapAtom, selectedEntityAtom } from "@/state/map"
import { COORDINATE_SYSTEM, type Layer as DeckGlLayer } from "@deck.gl/core"
import { type GeoBoundingBox, TileLayer } from "@deck.gl/geo-layers"
import {
	BitmapLayer,
	GeoJsonLayer,
	PathLayer,
	ScatterplotLayer,
} from "@deck.gl/layers"
import { bboxPolygon } from "@turf/turf"
import { useAtom, useAtomValue } from "jotai"
import type { GeoBbox2D, Osm } from "osm.ts"
import { useEffect, useMemo } from "react"
import useStartTaskLog from "./log"
import { useOsmWorker } from "./osm"

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

export function usePickableOsmTileLayer(osm?: Osm | null) {
	const startTaskLog = useStartTaskLog()
	const osmWorker = useOsmWorker()

	const [selectedEntity, setSelectedEntity] = useAtom(selectedEntityAtom)
	const layer = useMemo(() => {
		const bbox = osm?.bbox()
		const osmId = osm?.id
		if (!osmWorker || !osm || !osmId || !bbox) return null
		const idPrefix = `${APPID}:${osmId}:tiles`
		return new TileLayer<Awaited<
			| ReturnType<typeof osmWorker.getTileData>
			| ReturnType<typeof osmWorker.getTileBitmap>
		> | null>({
			id: idPrefix,
			extent: bbox,
			getTileData: async (tile) => {
				if (tile.index.z < MIN_PICKABLE_ZOOM) {
					const taskLog = startTaskLog(
						`generating bitmap for tile ${tile.index.z}/${tile.index.x}/${tile.index.y}`,
						"debug",
					)
					const bbox = tile.bbox as GeoBoundingBox
					const data = await osmWorker.getTileBitmap(
						osmId,
						[bbox.west, bbox.south, bbox.east, bbox.north],
						tile.index,
						BITMAP_TILE_SIZE,
					)
					taskLog.end(
						`bitmap for tile ${tile.index.z}/${tile.index.x}/${tile.index.y} generated`,
						"debug",
					)
					return data
				}

				// Show pickable data
				const bbox = tile.bbox as GeoBoundingBox
				const taskLog = startTaskLog(
					`generating data for tile ${tile.index.z}/${tile.index.x}/${tile.index.y}`,
					"debug",
				)
				const data = await osmWorker.getTileData(osmId, [
					bbox.west,
					bbox.south,
					bbox.east,
					bbox.north,
				])
				taskLog.end(
					`tile data for ${tile.index.z}/${tile.index.x}/${tile.index.y} generated`,
					"debug",
				)
				if (tile.signal?.aborted || !data) return null
				return data
			},
			autoHighlight: true,
			onClick: (info, event) => {
				info.sourceLayer?.onClick?.(info, event)
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
							visible: z < MIN_PICKABLE_ZOOM,
							_imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
							bounds: [
								tileBbox.west,
								tileBbox.south,
								tileBbox.east,
								tileBbox.north,
							],
							image: {
								data:
									data.bitmap ??
									new Uint8Array(BITMAP_TILE_SIZE * BITMAP_TILE_SIZE * 4),
								width: BITMAP_TILE_SIZE,
								height: BITMAP_TILE_SIZE,
							},
						}),
					)
				}

				if ("ways" in data) {
					layers.push(
						new PathLayer({
							id: `${tilePrefix}:ways`,
							data: {
								length: data.ways.positions.length / 2,
								startIndices: data.ways.startIndices,
								attributes: {
									getPath: { value: data.ways.positions, size: 2 },
								},
							},
							getWidth: 3,
							widthUnits: "meters",
							widthMinPixels: 0.5,
							widthMaxPixels: 10,
							getColor: [255, 255, 255, 255],
							pickable: true,
							autoHighlight: true,
							highlightColor: [255, 0, 0, 255 * 0.5],
							_pathType: "open",
							onClick: (info) => {
								if (info.picked && data.ways) {
									const wayId = data.ways.ids.at(info.index)
									if (wayId !== undefined) {
										setSelectedEntity(osm.ways.getById(wayId))
									} else {
										setSelectedEntity(null)
									}
									return true
								}
							},
						}),
					)
				}

				if ("nodes" in data) {
					layers.push(
						new ScatterplotLayer({
							id: `${tilePrefix}:nodes`,
							data: {
								length: data.nodes.positions.length / 2,
								attributes: {
									getPosition: { value: data.nodes.positions, size: 2 },
								},
							},
							pickable: true,
							autoHighlight: true,
							radiusUnits: "meters",
							getRadius: 3,
							radiusMinPixels: 1,
							radiusMaxPixels: 10,
							getFillColor: [255, 255, 255, 255],
							highlightColor: [255, 0, 0, 255 * 0.5],
							onClick: (info) => {
								if (info.picked) {
									const nodeId = data.nodes.ids.at(info.index)
									if (nodeId) {
										setSelectedEntity(osm.nodes.getById(nodeId))
									} else {
										setSelectedEntity(null)
									}
									return true
								}
							},
						}),
					)
				}

				if (
					process.env.NODE_ENV === "development" &&
					tile.bbox &&
					"west" in tile.bbox
				) {
					layers.push(
						new GeoJsonLayer({
							id: `${tilePrefix}:bbox`,
							data: bboxPolygon([
								tile.bbox.west,
								tile.bbox.south,
								tile.bbox.east,
								tile.bbox.north,
							]),
							lineWidthUnits: "pixels",
							lineDashArray: [10, 10],
							getLineColor: [255, 0, 0, 255 * 0.25],
							filled: false,
						}),
					)
				}
				return layers
			},
		})
	}, [osm, osmWorker, setSelectedEntity, startTaskLog])

	return {
		layer,
		setSelectedEntity,
		selectedEntity,
	}
}

export function useSelectedEntityLayer(osm?: Osm | null) {
	const selectedEntity = useAtomValue(selectedEntityAtom)
	return useMemo(() => {
		if (!osm || !selectedEntity) return null
		const geojson = osm.getEntityGeoJson(selectedEntity)
		return new GeoJsonLayer({
			id: `${APPID}:${osm.id}:selected-entity`,
			data: geojson,
			getLineColor: [255, 0, 0, 255],
			getLineWidth: 3,
			pointRadiusMinPixels: 2,
			pointRadiusMaxPixels: 10,
			lineWidthMinPixels: 2,
			lineWidthMaxPixels: 10,
			filled: false,
		})
	}, [osm, selectedEntity])
}
