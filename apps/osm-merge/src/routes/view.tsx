import { mapAtom } from "@/atoms"
import Basemap from "@/components/basemap"
import DeckGlOverlay from "@/components/deckgl-overlay"
import { GeoJsonLayer } from "@deck.gl/layers"
import { useAtomValue } from "jotai"
import { showSaveFilePicker } from "native-file-system-adapter"
import { Osm, osmToPrimitiveBlocks, writePbfToStream } from "osm.ts"
import { useCallback, useEffect, useMemo, useState } from "react"
import ObjectToTable from "../object-to-table"
import { objectToHtmlTableString } from "../utils"

const DEFAULT_PBF_FILE = "monaco-250101.osm.pbf"
const DEFAULT_PBF_URL = `./pbfs/${DEFAULT_PBF_FILE}`

export default function ViewPage() {
	const map = useAtomValue(mapAtom)
	const [osm, setOsm] = useState<Osm | null>(null)
	const [file, setFile] = useState<Blob | null>(null)
	const [fileName, setFileName] = useState<string | null>(null)
	const features = useMemo(() => {
		return osm?.toGeoJSON()
	}, [osm])
	const bbox = useMemo(() => osm?.bbox(), [osm])

	useEffect(() => {
		if (map == null || bbox == null) return
		map.fitBounds(bbox)
	}, [bbox, map])

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
		setOsm(null)
		if (file == null) {
			fetch(DEFAULT_PBF_URL)
				.then((res) => res.blob())
				.then((blob) => {
					setFile(blob)
					setFileName(DEFAULT_PBF_FILE)
				})
		} else {
			const fileStream = file.stream()
			Osm.fromPbfData(fileStream).then(async (osm) => {
				setOsm(osm)
			})
		}
	}, [file])

	const downloadPbf = useCallback(async () => {
		if (osm == null) return
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
		const primitives = osmToPrimitiveBlocks(osm)
		await writePbfToStream(stream, osm.header, primitives)
		await stream.close()
		window.alert(`PBF file saved to ${fileHandle.name}!`)
	}, [osm])

	return (
		<div className="flex flex-row">
			<div className="flex flex-col flex-1 pt-3 px-2">
				<h1 className="text-2xl font-bold">osm merge</h1>
				<input
					className="border border-slate-300 p-2"
					type="file"
					id="file"
					onChange={(e) => {
						const file = e.target.files?.[0]
						if (file) {
							setFile(file)
							setFileName(file.name)
						}
					}}
				/>
				<div>File name: {fileName}</div>
				<div>BBox: {bbox ? bbox.join(",") : "unknown"}</div>
				<h2>File header</h2>
				<table>
					<ObjectToTable object={osm?.header ?? null} />
				</table>
				<button
					className="bg-slate-950 text-white p-2 rounded-md cursor-pointer"
					type="button"
					onClick={downloadPbf}
					disabled={osm?.header == null}
				>
					Download
				</button>
			</div>
			<div className="h-dvh grow-3 relative">
				<Basemap>
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
				</Basemap>
			</div>
		</div>
	)
}
