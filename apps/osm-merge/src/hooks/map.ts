import { APPID, BITMAP_TILE_SIZE, MIN_PICKABLE_ZOOM } from "@/settings"
import { mapAtom } from "@/state/map"
import {
	selectOsmEntityAtom,
	selectedEntityAtom,
	selectedOsmAtom,
} from "@/state/osm"
import { COORDINATE_SYSTEM, type Layer as DeckGlLayer } from "@deck.gl/core"
import { type GeoBoundingBox, TileLayer } from "@deck.gl/geo-layers"
import {
	BitmapLayer,
	GeoJsonLayer,
	PathLayer,
	ScatterplotLayer,
} from "@deck.gl/layers"
import { bboxPolygon } from "@turf/turf"
import { useAtomValue, useSetAtom } from "jotai"
import type { GeoBbox2D, Osm, OsmEntity } from "osm.ts"
import { useCallback, useEffect, useMemo } from "react"
import useStartTaskLog from "./log"
import { osmWorker } from "@/state/worker"
import { isNode } from "osm.ts/utils"

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

export function useFlyToEntity() {
	const map = useAtomValue(mapAtom)

	return useCallback(
		(osm: Osm, entity: OsmEntity) => {
			if (!map) return
			if (isNode(entity)) {
				map.flyTo({
					center: [entity.lon, entity.lat],
					padding: 200,
					maxDuration: 200,
					zoom: 16,
				})
			} else {
				const bbox = osm.getEntityBbox(entity)
				map.fitBounds(bbox, {
					padding: 100,
					maxDuration: 200,
				})
			}
		},
		[map],
	)
}

export function useFlyToOsmBounds() {
	const map = useAtomValue(mapAtom)

	return useCallback(
		(osm: Osm) => {
			if (!map) return
			const bbox = osm.bbox()
			if (bbox) {
				map.fitBounds(bbox, {
					padding: 100,
					maxDuration: 200,
				})
			}
		},
		[map],
	)
}

const EMPTY_BITMAP = new Uint8Array(BITMAP_TILE_SIZE * BITMAP_TILE_SIZE * 4)

export function useBitmapTileLayer(osm?: Osm | null) {
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
	}, [osm])
}

export function usePickableOsmTileLayer(osm?: Osm | null) {
	const startTaskLog = useStartTaskLog()
	const selectEntity = useSetAtom(selectOsmEntityAtom)

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
										selectEntity(osm, osm.ways.getById(wayId))
									} else {
										selectEntity(null, null)
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
										selectEntity(osm, osm.nodes.getById(nodeId))
									} else {
										selectEntity(null, null)
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
	}, [osm, selectEntity, startTaskLog])

	return layer
}

export function useSelectedEntityLayer() {
	const selectedOsm = useAtomValue(selectedOsmAtom)
	const selectedEntity = useAtomValue(selectedEntityAtom)
	const layer = useMemo(() => {
		if (!selectedOsm || !selectedEntity) return null
		const geojson = selectedOsm.getEntityGeoJson(selectedEntity)
		return new GeoJsonLayer({
			id: `${APPID}:${selectedOsm.id}:selected-entity`,
			data: geojson,
			getLineColor: [255, 0, 0, 255],
			getLineWidth: 3,
			pointRadiusMinPixels: 2,
			pointRadiusMaxPixels: 10,
			lineWidthMinPixels: 2,
			lineWidthMaxPixels: 10,
			filled: false,
		})
	}, [selectedEntity, selectedOsm])
	return layer
}
