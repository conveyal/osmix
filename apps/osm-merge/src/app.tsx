import type { DeckProps } from "@deck.gl/core"
import { GeoJsonLayer } from "@deck.gl/layers"
import { MapboxOverlay } from "@deck.gl/mapbox"
import * as osm from "osm.ts"
import { useEffect, useMemo, useRef, useState } from "react"
import {
	type MapRef,
	Map as MaplibreMap,
	NavigationControl,
	useControl,
} from "react-map-gl/maplibre"
import ObjectToTable from "./object-to-table"
import { objectToHtmlTableString } from "./utils"

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
	const [headerBlock, setHeaderBlock] = useState<osm.OsmPbfHeaderBlock | null>(
		null,
	)
	const [bbox, setBbox] = useState<osm.Bbox | null>(null)
	const [stats, setStats] = useState<osm.OsmReadStats | null>(null)
	const [features, setFeatures] = useState<osm.OsmGeoJSONFeature[]>([])

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
		if (file == null) {
			fetch("./pbfs/spokane.osm.pbf")
				.then((res) => res.blob())
				.then((blob) => {
					setFile(blob)
					setFileName("spokane.osm.pbf")
				})
		} else {
			const fileStream = file.stream()
			osm
				.createOsmPbfReadStream(fileStream)
				.then(async ({ header, blocks, stats }) => {
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

					const r = await osm.blocksToGeoJSON(blocks, {
						withInfo: true,
						withTags: true,
					})
					const features = await Array.fromAsync(r.generateFeatures)
					setFeatures(features)
					setStats(stats)
				})
		}
	}, [file])

	return (
		<div className="flex flex-row">
			<div className="flex flex-col flex-1 pt-3 px-2">
				<h1 className="text-2xl font-bold">osm merge</h1>
				<input type="file" id="file" />
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
