import useStartTask from "@/hooks/log"
import { useOsmFile, useOsmWorker } from "@/hooks/osm"
import { APPID, MIN_PICKABLE_ZOOM } from "@/settings"
import { addLogMessageAtom } from "@/state/log"
import { mapAtom } from "@/state/map"
import { COORDINATE_SYSTEM, type Layer as DeckGlLayer } from "@deck.gl/core"
import { TileLayer, type GeoBoundingBox } from "@deck.gl/geo-layers"
import {
	BitmapLayer,
	GeoJsonLayer,
	PathLayer,
	ScatterplotLayer,
} from "@deck.gl/layers"
import { bboxPolygon } from "@turf/turf"
import { useAtomValue, useSetAtom } from "jotai"
import { MaximizeIcon } from "lucide-react"
import type { OsmNode, OsmWay } from "osm.ts"
import * as Performance from "osm.ts/performance"
import { useEffect, useMemo, useState } from "react"
import { Layer, Source } from "react-map-gl/maplibre"
import Basemap from "./basemap"
import DeckGlOverlay from "./deckgl-overlay"
import EntityDetails from "./entity-details"
import { Main, MapContent, Sidebar } from "./layout"
import OsmInfoTable from "./osm-info-table"
import OsmPbfFileInput from "./osm-pbf-file-input"
import { Button } from "./ui/button"

const TILE_SIZE = 1024

export default function ViewPage() {
	const [file, setFile] = useState<File | null>(null)
	const osmId = useMemo(() => file?.name ?? "default", [file])
	const map = useAtomValue(mapAtom)
	const osmWorker = useOsmWorker()
	const [osm, setOsm, isLoadingFile] = useOsmFile(file)
	const bbox = useMemo(() => osm?.bbox(), [osm])
	const logMessage = useSetAtom(addLogMessageAtom)
	const startTask = useStartTask()
	const [selectedEntity, setSelectedEntity] = useState<OsmNode | OsmWay | null>(
		null,
	)

	// Set message to "Ready" when the application is ready
	useEffect(() => {
		logMessage("Ready", "ready")
		Performance.mark("Ready")
	}, [logMessage])

	// Auto load default file for faster testing
	useEffect(() => {
		if (process.env.NODE_ENV !== "development") return
		if (!file) {
			fetch("./pbfs/monaco.pbf")
				.then((res) => res.blob())
				.then((blob) => {
					setFile((file) => (file ? file : new File([blob], "monaco.pbf")))
				})
		}
	}, [file])

	const tileLayer = useMemo(() => {
		if (!osmWorker || !bbox || !osm) return null
		const idPrefix = `${APPID}:${osmId}:tiles`
		return new TileLayer<Awaited<
			| ReturnType<typeof osmWorker.getTileData>
			| ReturnType<typeof osmWorker.getTileBitmap>
		> | null>({
			id: idPrefix,
			extent: bbox,
			getTileData: async (tile) => {
				if (tile.index.z < MIN_PICKABLE_ZOOM) {
					const task = startTask(
						`generating bitmap for tile ${tile.index.z}/${tile.index.x}/${tile.index.y}`,
						"debug",
					)
					const bbox = tile.bbox as GeoBoundingBox
					const data = await osmWorker.getTileBitmap(
						osmId,
						[bbox.west, bbox.south, bbox.east, bbox.north],
						tile.index,
						TILE_SIZE,
					)
					task.end(
						`bitmap for tile ${tile.index.z}/${tile.index.x}/${tile.index.y} generated`,
						"debug",
					)
					return data
				}

				// Show pickable data
				const bbox = tile.bbox as GeoBoundingBox
				const task = startTask(
					`generating data for tile ${tile.index.z}/${tile.index.x}/${tile.index.y}`,
					"debug",
				)
				const data = await osmWorker.getTileData(osmId, [
					bbox.west,
					bbox.south,
					bbox.east,
					bbox.north,
				])
				task.end(
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
								data: data.bitmap ?? new Uint8Array(TILE_SIZE * TILE_SIZE * 4),
								width: TILE_SIZE,
								height: TILE_SIZE,
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
									ids: data.nodes.ids,
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
								console.log("ScatterplotLayer.onClick", info)
								if (info.picked) {
									const nodeId = data.nodes.ids.at(info.index)
									if (nodeId) {
										setSelectedEntity(osm.nodes.getById(nodeId))
									}
									return true
								}
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
								console.log("PathLayer.onClick", info)
								if (info.picked && data.ways) {
									const wayId = data.ways.ids.at(info.index)
									if (wayId !== undefined) {
										setSelectedEntity(osm.ways.getById(wayId))
									}
								}
							},
						}),
					)
				}

				if (tile.bbox && "west" in tile.bbox) {
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
	}, [bbox, osm, osmId, osmWorker, startTask])

	return (
		<Main>
			<Sidebar>
				<div className="flex flex-col p-4 gap-2">
					<OsmPbfFileInput
						isLoading={isLoadingFile}
						file={file}
						setFile={(file) => {
							setSelectedEntity(null)
							setFile(file)
						}}
					/>

					{osm && file && (
						<>
							<div className="px-1 flex justify-between">
								<div className="font-bold">OPENSTREETMAP PBF</div>
								<Button
									onClick={() => {
										const bbox = osm.bbox()
										if (bbox)
											map?.fitBounds(bbox, {
												padding: 100,
												maxDuration: 0,
											})
									}}
									variant="ghost"
									size="icon"
									className="size-4"
									title="Fit bounds to file bbox"
								>
									<MaximizeIcon />
								</Button>
							</div>
							<OsmInfoTable file={file} osm={osm} />
							{selectedEntity == null ? (
								<div className="px-1 text-center font-bold">
									SELECT ENTITY ON MAP (Z{MIN_PICKABLE_ZOOM} AND UP)
								</div>
							) : (
								<div>
									<div className="px-1 flex justify-between">
										<div className="font-bold">SELECTED ENTITY</div>
										<Button
											onClick={() => {
												const bbox = osm?.getEntityBbox(selectedEntity)
												if (bbox)
													map?.fitBounds(bbox, {
														padding: 100,
														maxDuration: 0,
													})
											}}
											variant="ghost"
											size="icon"
											className="size-4"
											title="Fit bounds to entity"
										>
											<MaximizeIcon />
										</Button>
									</div>
									<EntityDetails
										entity={selectedEntity}
										osm={osm}
										onSelect={setSelectedEntity}
									/>
								</div>
							)}
						</>
					)}
				</div>
			</Sidebar>
			<MapContent>
				<Basemap>
					{bbox && (
						<Source type="geojson" data={bboxPolygon(bbox)}>
							<Layer
								type="line"
								paint={{ "line-color": "red", "line-width": 10 }}
							/>
						</Source>
					)}
					<DeckGlOverlay
						layers={[tileLayer]}
						pickingRadius={5}
						getTooltip={(pickingInfo) => {
							const sourceLayerId = pickingInfo.sourceLayer?.id
							if (sourceLayerId?.startsWith(`${APPID}:${osmId}`)) {
								if (sourceLayerId.includes("nodes")) {
									return {
										className: "deck-tooltip",
										html: `<h3 className="p-2">node</h3>`,
									}
								}
								if (sourceLayerId.includes("ways")) {
									return {
										className: "deck-tooltip",
										html: `<h3 className="p-2">way</h3>`,
									}
								}
							}
							return null
						}}
					/>
				</Basemap>
			</MapContent>
		</Main>
	)
}
