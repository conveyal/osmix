import { GeoJsonLayer } from "@deck.gl/layers"
import { MapboxOverlay } from "@deck.gl/mapbox"
import { Map as MapLibreMap } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import * as osm from "./lib/index.ts"

const map = new MapLibreMap({
	container: "map",
	style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
	center: [7.5, 43.6],
	zoom: 10,
})

await map.once("load")

function flattenValue(value: unknown): string {
	if (typeof value === "string") {
		return value
	}
	if (typeof value === "number") {
		return value.toLocaleString()
	}
	if (typeof value === "boolean") {
		return value.toString()
	}
	if (Array.isArray(value)) {
		return value.map((v) => flattenValue(v)).join(",")
	}
	if (typeof value === "object" && value !== null) {
		return Object.entries(value)
			.map(([key, value]) => {
				return `${key}=${flattenValue(value)}`
			})
			.join(",")
	}
	return ""
}

function objectToHtmlTableString(
	object: Record<string, string | number | boolean | unknown>,
) {
	return Object.entries(object)
		.filter(([key, value]) => {
			return typeof value !== "undefined"
		})
		.map(([key, value]) => {
			const valueString =
				key.includes("timestamp") && typeof value === "number"
					? new Date(value).toLocaleString()
					: flattenValue(value)
			return `<tr><td>${key}</td><td>${valueString}</td></tr>`
		})
		.join("")
}

const deckInstance = new MapboxOverlay({
	interleaved: true,
	layers: [],
	getTooltip: ({ object }) => {
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
	},
})

map.addControl(deckInstance)

console.log("script loaded", osm)
function $<EL extends HTMLElement>(id: string): EL {
	const $el = document.querySelector(id) as EL
	if (!$el) throw new Error(`element with id ${id} not found`)
	return $el
}

const fileInput = $<HTMLInputElement>("#file")
const fileName = $<HTMLPreElement>("#file-name")
const headerEl = $<HTMLPreElement>("#header")
const statsEl = $<HTMLPreElement>("#stats")
const entitiesEl = $<HTMLPreElement>("#entities")
const bboxEl = $<HTMLPreElement>("#bbox")

async function readFile(file: Blob) {
	const fileStream = file.stream()

	const startTime = performance.now()
	const osmPbfStream = await osm.createOsmPbfStream(fileStream)
	headerEl.innerHTML = `<tbody>${objectToHtmlTableString(osmPbfStream.header)}</tbody>`

	if (osmPbfStream.header.bbox) {
		const hbb = osmPbfStream.header.bbox
		map.fitBounds([hbb.left, hbb.bottom, hbb.right, hbb.top])
	}

	const features: osm.OsmGeoJSONFeature[] = []
	const setGeoJsonLayer = () => {
		map.fitBounds(bbox)
		deckInstance.setProps({
			layers: [
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
		})
	}

	let totalFeatures = 0
	const { generateFeatures, bbox } = await osm.blocksToGeoJSON(
		osmPbfStream.blocks,
		{
			withInfo: true,
			withTags: true,
		},
	)
	for await (const feature of generateFeatures) {
		features.push(feature)
		totalFeatures++
		entitiesEl.textContent = `${totalFeatures}`

		// Update the bbox from the feature
		if (feature.bbox) {
			bbox[0] = Math.min(bbox[0], feature.bbox[0])
			bbox[1] = Math.min(bbox[1], feature.bbox[1])
			bbox[2] = Math.max(bbox[2], feature.bbox[2])
			bbox[3] = Math.max(bbox[3], feature.bbox[3])
		} else if (
			feature.geometry.type === "Point" &&
			feature.geometry.coordinates[0] &&
			feature.geometry.coordinates[1]
		) {
			bbox[0] = Math.min(bbox[0], feature.geometry.coordinates[0])
			bbox[1] = Math.min(bbox[1], feature.geometry.coordinates[1])
			bbox[2] = Math.max(bbox[2], feature.geometry.coordinates[0])
			bbox[3] = Math.max(bbox[3], feature.geometry.coordinates[1])
		}
	}
	setGeoJsonLayer()
	map.fitBounds(bbox)

	bboxEl.textContent = `${bbox.join(",")}`
	statsEl.innerHTML = `<tbody>${objectToHtmlTableString({
		...osmPbfStream.stats,
		parseTime: `${(performance.now() - startTime).toFixed(2)}ms`,
	})}</tbody>`
}

fileInput.addEventListener("change", async (e) => {
	console.log("file.onchange")
	const file = fileInput.files?.[0]
	if (!file) throw new Error("file not found")
	console.log("file", file)
	fileName.textContent = file.name
	await readFile(file)
})

const defaultFile = await fetch("./monaco-250101.osm.pbf")
readFile(await defaultFile.blob())
fileName.textContent = "monaco-250101.osm.pbf"
