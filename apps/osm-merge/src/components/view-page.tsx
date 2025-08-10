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
import { OsmPbfFileInput } from "./filepicker"
import { Source, Layer } from "react-map-gl/maplibre"
import { Button } from "./ui/button"
import type { OsmPbfHeaderBlock } from "../../../../packages/osm.ts/src/pbf/proto/osmformat"
import { addLogMessageAtom } from "@/atoms"
import { APPID, MIN_PICKABLE_ZOOM } from "@/settings"
import * as Performance from "osm.ts/performance"
import Log from "./log"

const TILE_SIZE = 1024

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
	const [osm, setOsm] = useState<Osm | null>(null)
	const [osmInfo, setOsmInfo] = useState<{
		bbox: GeoBbox2D
		nodes: number
		ways: number
		relations: number
		header: OsmPbfHeaderBlock
		parsingTimeMs: number
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

	useEffect(() => {
		if (!file || !map || !osmWorker) {
			setOsmInfo(null)
			return
		}
		logMessage(`Processing file ${file.name}...`)
		const stream = file.stream()
		setOsm(null)
		setOsmInfo(null)
		osmWorker
			.initFromPbfData(
				osmId,
				Comlink.transfer(stream, [stream]),
				Comlink.proxy((msg) => logMessage(msg)),
			)
			.then(async (osmBuffers) => {
				if (file === currentFileRef.current) {
					const osm = Osm.from(osmBuffers)
					const bbox = osm.bbox()
					if (!bbox) throw Error("Osm not loaded. No bbox.")

					setOsm(osm)
					setOsmInfo({
						bbox,
						nodes: osm.nodes.size,
						ways: osm.ways.size,
						relations: osm.relations.size,
						header: osm.header,
						parsingTimeMs: osm.parsingTimeMs,
					})
					logMessage(`${file.name} fully loaded.`, "ready")
				}
			})
			.catch((e) => {
				console.error(e)
				logMessage(`${file.name} failed to load.`, "error")
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
					"ready",
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
		if (!osmWorker || !osmInfo || !bbox || !osm) return null
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
				)
				const data = await osmWorker.getTileData(osmId, [
					bbox.west,
					bbox.south,
					bbox.east,
					bbox.north,
				])
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
									dispatch({
										type: "SELECT",
										tileIndex: info.index,
										index: nodeIndex,
										entityType: "node",
									})
									const node = osm.nodes.getByIndex(nodeIndex)
									dispatch({
										type: "SET_NODE",
										index: nodeIndex,
										node,
									})
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
									dispatch({
										type: "SELECT",
										tileIndex: info.index,
										index: wayIndex,
										entityType: "way",
									})
									const way = osm.ways.getByIndex(wayIndex)
									const nodes = way.refs.map((ref) => osm.nodes.getById(ref))
									dispatch({
										type: "SET_WAY",
										index: wayIndex,
										way: {
											way,
											nodes,
										},
									})
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
	}, [bbox, logMessage, osm, osmId, osmInfo, osmWorker])

	return (
		<div className="flex flex-row grow-1 h-full overflow-hidden">
			<div className="flex flex-col w-96 gap-4 py-4 px-4 overflow-y-auto">
				<OsmPbfFileInput
					file={file}
					setFile={(file) => {
						setOsmInfo(null)
						setOsm(null)
						dispatch({ type: "CLEAR" })
						setFile(file)
					}}
				/>
				<div className="flex flex-col gap-2">
					<div>file: {osmId}</div>
					<div>
						parsing time:{" "}
						{osmInfo
							? `${(osmInfo.parsingTimeMs / 1_000).toFixed(3)}s`
							: "incomplete"}
					</div>
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
				nodes.map((node) => {
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
