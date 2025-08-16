import { useOsmWorker } from "@/hooks/osm"
import { mapAtom } from "@/state/map"
import { COORDINATE_SYSTEM, type Layer as DeckGlLayer } from "@deck.gl/core"
import { type GeoBoundingBox, TileLayer } from "@deck.gl/geo-layers"
import {
	BitmapLayer,
	GeoJsonLayer,
	PathLayer,
	ScatterplotLayer,
} from "@deck.gl/layers"
import { bboxPolygon } from "@turf/turf"
import * as Comlink from "comlink"
import { useAtomValue, useSetAtom } from "jotai"
import { Osm, type GeoBbox2D, type OsmNode, type OsmWay } from "osm.ts"
import {
	Fragment,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react"
import Basemap from "./basemap"
import DeckGlOverlay from "./deckgl-overlay"
import OsmPbfFileInput from "./osm-pbf-file-input"
import { Source, Layer } from "react-map-gl/maplibre"
import { Button } from "./ui/button"
import { addLogMessageAtom } from "@/state/log"
import { APPID, MIN_PICKABLE_ZOOM } from "@/settings"
import * as Performance from "osm.ts/performance"
import FitBounds from "./fit-bounds"
import CustomControl from "./custom-control"
import OsmInfoTable from "./osm-info-table"
import { isNode, isWay } from "osm.ts/utils"
import { MaximizeIcon } from "lucide-react"

const TILE_SIZE = 1024

export default function ViewPage() {
	const [isLoadingFile, setIsLoadingFile] = useState(false)
	const [file, setFile] = useState<File | null>(null)
	const osmId = useMemo(() => file?.name ?? "default", [file])
	const map = useAtomValue(mapAtom)
	const osmWorker = useOsmWorker()
	const [osm, setOsm] = useState<Osm | null>(null)
	const bbox = useMemo(() => osm?.bbox(), [osm])
	const logMessage = useSetAtom(addLogMessageAtom)
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
					setIsLoadingFile(true)
				})
		}
	}, [file])

	useEffect(() => {
		if (!file || !map || !osmWorker) {
			return
		}
		logMessage(`Processing file ${file.name}...`)
		const stream = file.stream()
		setOsm(null)
		setSelectedEntity(null)
		setIsLoadingFile(true)
		osmWorker
			.initFromPbfData(
				osmId,
				Comlink.transfer(stream, [stream]),
				Comlink.proxy((msg) => logMessage(msg)),
			)
			.then(async (osmBuffers) => {
				const osm = Osm.from(osmBuffers)
				const bbox = osm.bbox()
				if (!bbox) throw Error("Osm not loaded. No bbox.")

				map.fitBounds(bbox, {
					padding: 100,
					maxDuration: 200,
				})

				setOsm(osm)
				logMessage(`${file.name} fully loaded.`, "ready")
			})
			.catch((e) => {
				console.error(e)
				logMessage(`${file.name} failed to load.`, "error")
			})
			.finally(() => {
				setIsLoadingFile(false)
			})
	}, [file, osmId, osmWorker, logMessage, map])

	const tiledBitmapLayer = useMemo(() => {
		if (!osmId || !osmWorker || !bbox) return null
		const idPrefix = `${APPID}:${osmId}:bitmap-tiles`
		return new TileLayer<Awaited<
			ReturnType<typeof osmWorker.getTileBitmap>
		> | null>({
			id: idPrefix,
			extent: bbox,
			getTileData: async (tile) => {
				if (tile.index.z >= MIN_PICKABLE_ZOOM) return null
				logMessage(
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
				logMessage(
					`bitmap for tile ${tile.index.z}/${tile.index.x}/${tile.index.y} generated`,
					"debug",
				)
				return data
			},
			renderSubLayers: (props) => {
				const { tile, data } = props
				const { x, y, z } = tile.index
				const tileBbox = tile.bbox as GeoBoundingBox
				return [
					new BitmapLayer({
						id: `${idPrefix}:${z}/${x}/${y}`,
						visible: z < MIN_PICKABLE_ZOOM,
						_imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
						bounds: [
							tileBbox.west,
							tileBbox.south,
							tileBbox.east,
							tileBbox.north,
						],
						image: {
							data: data ?? new Uint8Array(TILE_SIZE * TILE_SIZE * 4),
							width: TILE_SIZE,
							height: TILE_SIZE,
						},
					}),
				]
			},
		})
	}, [logMessage, osmId, osmWorker, bbox])

	const tileLayer = useMemo(() => {
		if (!osmWorker || !bbox || !osm) return null
		const idPrefix = `${APPID}:${osmId}:tiles`
		return new TileLayer<Awaited<
			ReturnType<typeof osmWorker.getTileData>
		> | null>({
			id: idPrefix,
			extent: bbox,
			getTileData: async (tile) => {
				if (tile.index.z < MIN_PICKABLE_ZOOM) return null
				const bbox = tile.bbox as GeoBoundingBox
				logMessage(
					`generating data for tile ${tile.index.z}/${tile.index.x}/${tile.index.y}`,
					"debug",
				)
				const data = await osmWorker.getTileData(osmId, [
					bbox.west,
					bbox.south,
					bbox.east,
					bbox.north,
				])
				logMessage(
					`tile data for ${tile.index.z}/${tile.index.x}/${tile.index.y} generated`,
					"debug",
				)
				if (tile.signal?.aborted || !data) return null
				return data
			},
			autoHighlight: true,
			onClick: (info, event) => {
				console.log("TileLayer.onClick", info)
				info.sourceLayer?.onClick?.(info, event)
			},
			renderSubLayers: (props) => {
				const { tile, data } = props
				if (!data) return null
				const { x, y, z } = tile.index
				const tilePrefix = `${idPrefix}:${z}/${x}/${y}`
				const layers: DeckGlLayer[] = []
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
							console.log("ScatterplotLayer.onClick", info)
							if (info.picked) {
								const nodeIndex = data.nodes.indexes.at(info.index)
								if (nodeIndex) {
									setSelectedEntity(osm.nodes.getByIndex(nodeIndex))
								}
								return true
							}
						},
					}),
				)
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
								const wayIndex = data.ways.indexes.at(info.index)
								if (wayIndex !== undefined) {
									setSelectedEntity(osm.ways.getByIndex(wayIndex))
								}
							}
						},
					}),
				)

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
	}, [bbox, logMessage, osm, osmId, osmWorker])

	return (
		<div className="flex flex-row grow-1 h-full overflow-hidden">
			<div className="flex flex-col w-96 gap-2 py-1 overflow-y-auto overflow-x-hidden">
				<div className="px-1">
					<OsmPbfFileInput
						isLoading={isLoadingFile}
						file={file}
						setFile={(file) => {
							setSelectedEntity(null)
							setOsm(null)
							setFile(file)
						}}
					/>
				</div>
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
								{isNode(selectedEntity) && (
									<details open className="border-l border-b border-slate-950">
										<summary className="font-bold p-1">
											NODE {selectedEntity.id}
										</summary>
										<table className="w-full">
											<tbody>
												<tr>
													<td>lon</td>
													<td>{selectedEntity.lon}</td>
												</tr>
												<tr>
													<td>lat</td>
													<td>{selectedEntity.lat}</td>
												</tr>
												<TagList tags={selectedEntity.tags} />
											</tbody>
										</table>
									</details>
								)}
								{isWay(selectedEntity) && (
									<details open className="border-l border-b border-slate-950">
										<summary className="font-bold p-1">
											WAY {selectedEntity.id}
										</summary>
										<table className="w-full">
											<tbody>
												<TagList tags={selectedEntity.tags} />
											</tbody>
										</table>
										<NodeList
											onSelectNode={setSelectedEntity}
											nodes={selectedEntity.refs
												.map((nodeId) => osm.nodes.getById(nodeId))
												.filter((n) => n != null)}
										/>
									</details>
								)}
							</div>
						)}
					</>
				)}
			</div>
			<div className="relative grow-3 bg-slate-900">
				<Basemap>
					{bbox && (
						<Source type="geojson" data={bboxPolygon(bbox)}>
							<Layer
								type="line"
								paint={{ "line-color": "red", "line-width": 10 }}
							/>
						</Source>
					)}
					{bbox && (
						<CustomControl position="top-left">
							<FitBounds bounds={bbox} />
						</CustomControl>
					)}
					<DeckGlOverlay
						// useDevicePixels={false}
						layers={[tiledBitmapLayer, tileLayer]}
						pickingRadius={5}
						getTooltip={(pickingInfo) => {
							// console.log("getTooltip", pickingInfo)
							const sourceLayerId = pickingInfo.sourceLayer?.id
							if (sourceLayerId?.startsWith(`${APPID}:${osmId}`)) {
								if (sourceLayerId.includes("nodes")) {
									return "node"
								}
								if (sourceLayerId.includes("ways")) {
									return "way"
								}
							}
							return null
						}}
					/>
				</Basemap>
			</div>
		</div>
	)
}

function TagList({ tags }: { tags?: Record<string, unknown> }) {
	const entries = Object.entries(tags || {})
	if (entries.length === 0) return null
	return (
		<>
			{entries.map(([k, v]) => (
				<tr key={k}>
					<td>{k}</td>
					<td>{String(v)}</td>
				</tr>
			))}
		</>
	)
}

function NodeList({
	nodes,
	onSelectNode,
}: { nodes: OsmNode[]; onSelectNode: (node: OsmNode) => void }) {
	return (
		<details open className="border-b border-l border-slate-950">
			<summary className="p-1 font-bold shadow">
				NODE REFS ({nodes.length})
			</summary>
			<div className="max-h-96 overflow-y-scroll">
				<table className="table-auto">
					<tbody>
						{nodes.map((node, i) => (
							<Fragment key={node.id}>
								<tr
									onClick={() => onSelectNode(node)}
									onKeyDown={() => onSelectNode(node)}
									className="cursor-pointer"
								>
									<td>{i + 1}</td>
									<td>{node.id}</td>
									<td>
										{node.lon}, {node.lat}
									</td>
								</tr>
								{node.tags &&
									Object.entries(node.tags).map(([k, v]) => (
										<tr key={k}>
											<td />
											<td>{k}</td>
											<td>{String(v)}</td>
										</tr>
									))}
							</Fragment>
						))}
					</tbody>
				</table>
			</div>
		</details>
	)
}
