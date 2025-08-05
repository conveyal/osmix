import { useOsmWorker } from "@/hooks/osm"
import { mapAtom } from "@/state/map"
import type { Layer as DeckGlLayer } from "@deck.gl/core"
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
import type { GeoBbox2D, OsmNode, OsmWay } from "osm.ts"
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
import { OsmPbfFileInput } from "./filepicker"
import { Source, Layer } from "react-map-gl/maplibre"
import { Button } from "./ui/button"
import type { OsmPbfHeaderBlock } from "../../../../packages/osm.ts/src/pbf/proto/osmformat"
import { addLogMessageAtom } from "@/atoms"
import { MIN_PICKABLE_ZOOM } from "@/settings"
import Log from "./log"

const TILE_SIZE = 512

type SelectedEntityState = {
	index: number | null
	tileIndex: number | null
	type: "node" | "way" | null
	entity: OsmNode | { way: OsmWay; nodes: OsmNode[] } | null
}

type SelectedEntityActions =
	| {
			type: "SELECT"
			tileIndex: number
			index: number
			entityType: "node" | "way"
	  }
	| {
			type: "CLEAR"
	  }
	| {
			type: "SET_NODE"
			index: number
			node: OsmNode
	  }
	| {
			type: "SET_WAY"
			index: number
			way: {
				way: OsmWay
				nodes: OsmNode[]
			}
	  }

function reducer(
	state: SelectedEntityState,
	action: SelectedEntityActions,
): SelectedEntityState {
	switch (action.type) {
		case "SELECT":
			return {
				...state,
				index: action.index,
				tileIndex: action.tileIndex,
				type: action.entityType,
				entity: null,
			}
		case "CLEAR":
			return {
				tileIndex: null,
				index: null,
				type: null,
				entity: null,
			}
		case "SET_NODE":
			if (action.index === state.index && state.type === "node") {
				return {
					...state,
					entity: action.node,
				}
			}
			return state
		case "SET_WAY":
			if (action.index === state.index && state.type === "way") {
				return {
					...state,
					entity: action.way,
				}
			}
			return state
	}
}

export default function ViewPage() {
	const [file, setFile] = useState<File | null>(null)
	const osmId = useMemo(() => file?.name ?? "default", [file])
	const currentFileRef = useRef<File | null>(null)
	const map = useAtomValue(mapAtom)
	const osmWorker = useOsmWorker()
	const [osmInfo, setOsmInfo] = useState<{
		bbox: GeoBbox2D
		nodes: number
		ways: number
		header: OsmPbfHeaderBlock
	} | null>(null)
	const { bbox } = osmInfo ?? {}
	const logMessage = useSetAtom(addLogMessageAtom)

	const [selectedState, dispatch] = useReducer(reducer, {
		tileIndex: null,
		index: null,
		type: null,
		entity: null,
	})

	useEffect(() => {
		currentFileRef.current = file
	})

	useEffect(() => {
		if (!map || !bbox) return
		map.fitBounds(bbox, {
			padding: 100,
			maxDuration: 200,
		})
	}, [map, bbox])

	// Auto load default file for faster testing
	useEffect(() => {
		if (process.env.NODE_ENV !== "development") return
		if (!file) {
			fetch("./pbfs/monaco-250101.osm.pbf")
				.then((res) => res.blob())
				.then((blob) => {
					setFile((file) => (file ? file : new File([blob], "monaco.pbf")))
				})
		}
	}, [file])

	useEffect(() => {
		if (!file || !map || !osmWorker) {
			setOsmInfo(null)
			return
		}
		logMessage(`Processing file ${file.name}...`)
		const stream = file.stream()
		setOsmInfo(null)
		osmWorker
			.initFromPbfData(
				osmId,
				Comlink.transfer(stream, [stream]),
				Comlink.proxy((msg) => logMessage(msg)),
			)
			.then(async () => {
				if (file === currentFileRef.current) {
					const info = await osmWorker.info(osmId)
					if (info) {
						setOsmInfo(info)
						logMessage(`${file.name} fully loaded.`, "ready")
					} else {
						logMessage(`${file.name} failed to load.`, "error")
					}
				}
			})
	}, [file, osmId, osmWorker, logMessage, map])

	const tileLayer = useMemo(() => {
		if (!osmWorker || !osmInfo || !bbox) return null
		return new TileLayer<Awaited<
			ReturnType<typeof osmWorker.getTileData>
		> | null>({
			id: `osm-tk:tiles-${osmId}`,
			extent: bbox,
			tileSize: TILE_SIZE,
			getTileData: async (tile) => {
				const bbox = tile.bbox as GeoBoundingBox
				console.log("getTileData", tile)
				logMessage(
					`generating data for tile ${tile.index.z}/${tile.index.x}/${tile.index.y}`,
				)
				const data = await osmWorker.getTileData(
					osmId,
					[bbox.west, bbox.south, bbox.east, bbox.north],
					tile.index,
					TILE_SIZE,
				)
				logMessage(
					`tile data for ${tile.index.z}/${tile.index.x}/${tile.index.y} generated`,
					"ready",
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
				const { x, y, z } = tile.index
				if (!data) return null
				const tileBbox = tile.bbox as GeoBoundingBox
				const layers: DeckGlLayer[] = []
				if (data.bitmap) {
					layers.push(
						new BitmapLayer({
							id: `osm-tk:bitmap-${x}-${y}-${z}`,
							bounds: [
								tileBbox.west,
								tileBbox.south,
								tileBbox.east,
								tileBbox.north,
							],
							image: {
								data: data.bitmap,
								width: TILE_SIZE,
								height: TILE_SIZE,
							},
						}),
					)
				}
				if (data.nodes.positions && z > 10) {
					layers.push(
						new ScatterplotLayer({
							id: `osm-tk:nodes-${x}-${y}-${z}`,
							data: {
								length: data.nodes.positions.length / 2,
								attributes: {
									getPosition: { value: data.nodes.positions, size: 2 },
								},
							},
							pickable: z > MIN_PICKABLE_ZOOM,
							autoHighlight: z > MIN_PICKABLE_ZOOM,
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
										dispatch({
											type: "SELECT",
											tileIndex: info.index,
											index: nodeIndex,
											entityType: "node",
										})
										osmWorker.getNode(osmId, nodeIndex).then((node) => {
											if (!node)
												throw Error(`Node not found for index ${nodeIndex}`)
											dispatch({
												type: "SET_NODE",
												index: nodeIndex,
												node,
											})
										})
									}
									return true
								}
							},
						}),
					)
				}
				if (data.ways !== null) {
					layers.push(
						new PathLayer({
							id: `osm-tk:ways-${x}-${y}-${z}`,
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
							pickable: z > 12,
							autoHighlight: z > 12,
							highlightColor: [255, 0, 0, 255 * 0.5],
							_pathType: "open",
							onClick: (info) => {
								console.log("PathLayer.onClick", info)
								if (info.picked && data.ways) {
									const wayIndex = data.ways.indexes.at(info.index)
									if (wayIndex) {
										dispatch({
											type: "SELECT",
											tileIndex: info.index,
											index: wayIndex,
											entityType: "way",
										})
										osmWorker.getWay(osmId, wayIndex).then((way) => {
											if (!way)
												throw Error(`Way not found for index ${wayIndex}`)
											dispatch({
												type: "SET_WAY",
												index: wayIndex,
												way,
											})
										})
									}
								}
							},
						}),
					)
				}
				if (tile.bbox && "west" in tile.bbox) {
					layers.push(
						new GeoJsonLayer({
							id: `osm-tk:bbox-${x}-${y}-${z}`,
							data: bboxPolygon([
								tile.bbox.west,
								tile.bbox.south,
								tile.bbox.east,
								tile.bbox.north,
							]),
							lineWidthUnits: "pixels",
							getLineColor: [255, 0, 0, 255 * 0.25],
							filled: false,
						}),
					)
				}
				return layers
			},
		})
	}, [bbox, logMessage, osmId, osmInfo, osmWorker])

	return (
		<div className="flex flex-row grow-1 h-full overflow-hidden">
			<div className="flex flex-col w-96 gap-4 py-4 px-4 overflow-y-auto">
				<div>
					<OsmPbfFileInput
						file={file}
						setFile={(file) => {
							setOsmInfo(null)
							dispatch({ type: "CLEAR" })
							setFile(file)
						}}
					/>
					<div>file: {osmId}</div>
				</div>
				<div className="h-48">
					<Log />
				</div>
				<div className="grid grid-cols-2 gap-2.5 text-xs">
					{osmInfo && (
						<>
							<div className="col-span-2">
								bbox: {bbox?.map((n) => n.toFixed(6)).join(", ")}
							</div>
							<Button
								className="col-span-2"
								size="xs"
								onClick={() => {
									map?.fitBounds(osmInfo.bbox, {
										padding: 100,
										maxDuration: 200,
									})
								}}
							>
								fit bounds
							</Button>
							<div>nodes</div>
							<div>{osmInfo.nodes.toLocaleString()}</div>
							<div>ways</div>
							<div>{osmInfo.ways.toLocaleString()}</div>
							<div className="col-span-2">header</div>
							{Object.entries(osmInfo.header).map(([k, v]) => {
								return (
									<Fragment key={k}>
										<div className="break-all">{k}</div>
										<div className="break-all">
											{Array.isArray(v) ? v.join(", ") : String(v)}
										</div>
									</Fragment>
								)
							})}
						</>
					)}
					{selectedState.entity && "id" in selectedState.entity && (
						<>
							<div>node</div>
							<div>{selectedState.entity.id}</div>
							<TagList tags={selectedState.entity.tags} />
						</>
					)}
					{selectedState.entity && "way" in selectedState.entity && (
						<>
							<div>way id</div>
							<div>{selectedState.entity.way.id}</div>
							<TagList tags={selectedState.entity.way.tags} />
							<NodeList nodes={selectedState.entity.nodes} />
						</>
					)}
				</div>
			</div>
			<div className="relative grow-3">
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
						// useDevicePixels={false}
						layers={[tileLayer]}
						pickingRadius={5}
						getTooltip={(pickingInfo) => {
							// console.log("getTooltip", pickingInfo)
							if (pickingInfo.sourceLayer?.id?.startsWith("osm-tk:nodes-")) {
								return "node"
							}
							if (pickingInfo.sourceLayer?.id?.startsWith("osm-tk:ways-")) {
								return "way"
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
			<div className="font-bold">tags</div>
			<div>{entries.length}</div>
			{entries.map(([k, v]) => {
				return (
					<Fragment key={k}>
						<div>{k}</div>
						<div>{String(v)}</div>
					</Fragment>
				)
			})}
		</>
	)
}

function NodeList({ nodes }: { nodes: OsmNode[] }) {
	const [open, setOpen] = useState(true)
	return (
		<>
			<div className="font-bold">nodes</div>
			<div>{nodes.length}</div>
			<Button
				className="col-span-2"
				size="xs"
				onClick={() => setOpen((open) => !open)}
			>
				{open ? "hide" : "show"}
			</Button>
			{open &&
				nodes.map((node, i) => {
					return (
						<Fragment key={node.id}>
							<hr className="col-span-2" />
							<div className="font-bold">node id</div>
							<div>{node.id}</div>
							<div>lon</div>
							<div>{node.lon}</div>
							<div>lat</div>
							<div>{node.lat}</div>
							<TagList tags={node.tags} />
						</Fragment>
					)
				})}
		</>
	)
}
