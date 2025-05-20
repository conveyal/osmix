import type { DeckProps } from "@deck.gl/core"
import { GeoJsonLayer } from "@deck.gl/layers"
import { MapboxOverlay } from "@deck.gl/mapbox"
import { showSaveFilePicker } from "native-file-system-adapter"
import * as osm from "osm.ts"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
	type MapRef,
	Map as MaplibreMap,
	NavigationControl,
	useControl,
} from "react-map-gl/maplibre"
import ObjectToTable from "./object-to-table"
import { objectToHtmlTableString } from "./utils"

const DEFAULT_PBF_FILE = "monaco-250101.osm.pbf"
const DEFAULT_PBF_URL = `./pbfs/${DEFAULT_PBF_FILE}`

function DeckGlOverlay(props: DeckProps) {
	const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props))
	overlay.setProps(props)
	return null
}

const MAP_STYLE =
	"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
const MAP_CENTER = [7.5, 43.6] as const
const MAP_ZOOM = 10

export default function App() {
	const mapRef = useRef<MapRef>(null)
	const [file, setFile] = useState<Blob | null>(null)
	const [fileName, setFileName] = useState<string | null>(null)
	const [headerBlock, setHeaderBlock] =
		useState<osm.proto.OsmPbfHeaderBlock | null>(null)
	const [bbox, setBbox] = useState<osm.Bbox | null>(null)
	const [stats, setStats] = useState<osm.OsmReadStats | null>(null)

	const [nodes, setNodes] = useState<Map<number, osm.OsmNode>>(new Map())
	const [ways, setWays] = useState<osm.OsmWay[]>([])

	const features = useMemo(() => {
		return Array.fromAsync(osm.entitiesToGeoJSON({ nodes, ways }))
	}, [nodes, ways])

	useEffect(() => {
		if (mapRef.current == null) return
		if (bbox == null) return
		const map = mapRef.current.getMap()
		map.fitBounds(bbox)
	}, [bbox])

	const layers = useMemo(
		() => [
			new GeoJsonLayer({
				id: "osm-features",
				data: features,
				getPointRadius: 2,
				pointRadiusUnits: "meters",
				getFillColor: (d) => {
					if (d.geometry.type === "Polygon") {
						return [0, 255, 0, 255 * 0.5]
					}
					if (d.geometry.type === "Point") {
						return [0, 0, 255, 255 * 0.95]
					}
					return [0, 0, 0, 0]
				},
				getLineColor: [255, 0, 0, 255 * 0.95],
				getLineWidth: (d) => {
					if (d.geometry.type === "Point" || d.geometry.type === "Polygon") {
						return 0.5
					}
					return 5
				},
				lineWidthUnits: "meters",
				lineCapRounded: true,
				lineJointRounded: true,
				pickable: true,
				onClick(pickingInfo, event) {
					console.log("pickingInfo", pickingInfo)
					console.log("event", event)
				},
			}),
		],
		[features],
	)

	useEffect(() => {
		setHeaderBlock(null)
		setNodes(new Map())
		setWays([])
		setStats(null)
		if (file == null) {
			fetch(DEFAULT_PBF_URL)
				.then((res) => res.blob())
				.then((blob) => {
					setFile(blob)
					setFileName(DEFAULT_PBF_FILE)
				})
		} else {
			const fileStream = file.stream()
			osm
				.readOsmPbf(fileStream, { withTags: true })
				.then(async ({ header, nodes, ways, stats }) => {
					setHeaderBlock(header)
					if (header.bbox) {
						setBbox([
							header.bbox.left,
							header.bbox.bottom,
							header.bbox.right,
							header.bbox.top,
						])
					} else {
						setBbox(null)
					}

					setNodes(nodes)
					setWays(ways)
					setStats(stats)
				})
		}
	}, [file])

	const downloadPbf = useCallback(async () => {
		if (headerBlock == null) return
		const fileHandle = await showSaveFilePicker({
			suggestedName: "test-file.osm.pbf",
			types: [
				{
					description: "OSM PBF",
					accept: { "application/x-protobuf": [".pbf"] },
				},
			],
		})
		const stream = await fileHandle.createWritable()
		const primitives = osm.osmToPrimitiveBlocks({ nodes, ways, relations: [] })
		await osm.writePbfToStream(stream, headerBlock, primitives)
		await stream.close()
		window.alert(`PBF file saved to ${fileHandle.name}!`)
	}, [headerBlock, nodes, ways])

	return (
		<div className="flex flex-row">
			<div className="flex flex-col flex-1 pt-3 px-2">
				<h1 className="text-2xl font-bold">osm merge</h1>
				<input className="border border-slate-300 p-2" type="file" id="file" />
				<div>File name: {fileName}</div>
				<div>BBox: {bbox ? bbox.join(",") : "unknown"}</div>
				<h2>File header</h2>
				<table>
					<ObjectToTable object={headerBlock} />
				</table>
				<h2>Stats</h2>
				<table>
					<ObjectToTable object={stats} />
				</table>
				<button
					className="bg-slate-950 text-white p-2 rounded-md cursor-pointer"
					type="button"
					onClick={downloadPbf}
					disabled={headerBlock == null}
				>
					Download
				</button>
			</div>
			<div className="h-dvh grow-3 relative">
				<MaplibreMap
					ref={mapRef}
					mapStyle={MAP_STYLE}
					initialViewState={{
						longitude: MAP_CENTER[0],
						latitude: MAP_CENTER[1],
						zoom: MAP_ZOOM,
					}}
				>
					<NavigationControl />
					<DeckGlOverlay
						layers={layers}
						getTooltip={({ object }) => {
							if (!object) return null
							return {
								className: "deck-tooltip",
								html: `
								  <h3>${object.geometry.type === "Point" ? "Node" : "Way"}: ${object.id}</h3>
								  <h6>tags</h6>
								  <table><tbody>${objectToHtmlTableString(object.properties.tags)}</tbody></table>
								  <h6>info</h6>
								  <table><tbody>${objectToHtmlTableString(object.properties.info)}</tbody></table>
								`,
							}
						}}
					/>
				</MaplibreMap>
			</div>
		</div>
	)
}
