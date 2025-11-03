import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import type { GeoBbox2D, LonLat } from "@osmix/shared/types"
import maplibregl, { type ControlPosition } from "maplibre-gl"
import { nodesPaint, waysOutlinePaint, waysPaint } from "./map-style"

const map = new maplibregl.Map({
	container: "map",
	style: "https://tiles.openfreemap.org/styles/positron",
	zoom: 13,
})

const $log = document.getElementById("log")! as HTMLDialogElement
const $entity = addMapControl("entity", "bottom-left")
const $info = addMapControl("info", "top-left")
const $layerControl = addMapControl("layer-control", "top-right")
$info.innerHTML = `
    <header>OSMIX VT SERVER DEMO</header>
	<p>This page is a demo showing a server parsing the OSM PBF and generating vector tiles on the fly.</p>
	<p>See the code on <a href="https://github.com/conveyal/osmix" target="_blank">GitHub</a></p>
	<hr />
`
const $meta = document.createElement("div")
$meta.id = "meta"
$meta.textContent = "Loading..."
$info.append($meta)

map.once("styledata", updateLayerControl)

waitForServerReady()

/**
 * On initial load, the server needs to process the PBF in order to be ready to serve tiles.
 */
async function waitForServerReady() {
	try {
		const res = await fetch("/ready")
		const body = await res.json()
		if (body.ready) {
			$log.remove()
			await loadNewOsmMap()
		} else {
			if (!$log.open) $log.showModal()
			$log.innerHTML = `<pre>${body.log.reverse().join("\n")}</pre>`
			setTimeout(waitForServerReady, 1_000)
		}
	} catch (error) {
		console.error(`Error loading map: ${error}`)
	}
}

/**
 * Once the server is ready, we can remove the dialog and show the OSM map.
 */
async function loadNewOsmMap() {
	const res = await fetch("/meta.json")
	const meta: {
		bbox: GeoBbox2D
		center: LonLat
		filename: string
		header: OsmPbfHeaderBlock
		wayLayerName: string
		nodeLayerName: string
	} = await res.json()
	map.fitBounds(meta.bbox, {
		padding: 100,
		duration: 200,
	})
	$meta.innerHTML = `
		<dl>
			<dt>filename</dt>
			<dd>${meta.filename}</dd>

			<dt>writingprogram</dt>
			<dd>${meta.header.writingprogram}</dd>

			<dt>required features</dt>
			<dd>${meta.header.required_features.join(", ")}</dd>

			<dt>optional features</dt>
			<dd>${meta.header.optional_features.join(", ")}</dd>

			<dt title="osmosis replication timestamp">timestamp</dt>
			<dd>${new Date(meta.header.osmosis_replication_timestamp ?? 0).toISOString()}</dd>

			<dt>bbox</dt>
			<dd>${meta.bbox.join(", ")}</dd>
		</dl>
    `

	function addSourcesAndLayers() {
		const sourceId = "osmix"
		const beforeId = map
			.getLayersOrder()
			.find((id) => map.getLayer(id)?.type === "symbol")
		map.addSource(sourceId, {
			type: "vector",
			tiles: ["http://localhost:3000/tiles/{z}/{x}/{y}"],
			minzoom: 0,
			maxzoom: 22,
			bounds: meta.bbox,
		})
		map.addLayer(
			{
				id: "@osmix:ways:outline",
				type: "line",
				source: sourceId,
				"source-layer": meta.wayLayerName,
				filter: ["==", ["geometry-type"], "LineString"],
				paint: waysOutlinePaint,
				layout: {
					"line-join": "round",
				},
			},
			beforeId,
		)
		map.addLayer(
			{
				id: "@osmix:ways",
				type: "line",
				source: sourceId,
				"source-layer": meta.wayLayerName,
				filter: ["==", ["geometry-type"], "LineString"],
				paint: waysPaint,
				layout: {
					"line-join": "round",
				},
			},
			beforeId,
		)
		map.addLayer(
			{
				id: "@osmix:nodes",
				type: "circle",
				source: sourceId,
				"source-layer": meta.nodeLayerName,
				paint: nodesPaint,
			},
			beforeId,
		)

		const canvas = map.getCanvas()
		map.on("mouseover", ["@osmix:ways", "@osmix:nodes"], (e) => {
			canvas.style.cursor = "pointer"
			const features = e.features
			;[meta.wayLayerName, meta.nodeLayerName].forEach((sourceLayer) => {
				map.removeFeatureState({
					source: sourceId,
					sourceLayer: sourceLayer,
				})
			})
			if (features && features.length > 0) {
				let html = ""
				for (const feature of features) {
					map.setFeatureState(
						{
							source: feature.source,
							sourceLayer: feature.sourceLayer,
							id: feature.id,
						},
						{ hover: true },
					)
					html += featureToHtml(features[0])
				}
				$entity.innerHTML = html
			}
		})
		map.on("mouseout", ["@osmix:ways", "@osmix:nodes"], () => {
			canvas.style.cursor = ""
		})
	}

	if (map.isStyleLoaded()) {
		addSourcesAndLayers()
	} else {
		map.once("load", addSourcesAndLayers)
	}
}

function featureToHtml(feature: {
	id: string | number | undefined
	properties: Record<string, string>
	geometry: GeoJSON.Geometry
}) {
	const propKeys = Object.keys(feature.properties).sort()
	const rows = propKeys.map(
		(key) => `
		<tr>
			<td>${key}</td>
			<td>${feature.properties[key]}</td>
		</tr>
	`,
	)
	const html = `
		<header>${feature.properties.type}/${feature.id}</header>
		<hr />
		<table>
			<tbody>
				${rows.join("")}
			</tbody>
		</table>
    `
	return html
}

function updateLayerControl() {
	const layers = map.getLayersOrder().filter(([id]) => id != null)
	const rows = layers.map(
		(layer) => `
		<label>
			<input 
				name="${layer}" 
				type="checkbox" 
				${map.getLayoutProperty(layer, "visibility") !== "none" ? "checked" : ""} 
			/> ${layer}
		</label>
	`,
	)
	const html = `
			<header>LAYERS</header>
			<hr />
			${rows.join("")}
    `
	$layerControl.innerHTML = html
}

function addMapControl(id: string, placement: ControlPosition) {
	const $control = document.createElement("div")
	$control.id = id
	$control.className = "map-control"
	map.addControl(
		{
			onAdd() {
				return $control
			},
			onRemove() {},
		},
		placement,
	)
	return $control
}

document.addEventListener("change", (e) => {
	const target = e.target as HTMLInputElement
	if (target.parentElement?.parentElement?.id === "layer-control") {
		map.setLayoutProperty(
			target.name,
			"visibility",
			target.checked ? "visible" : "none",
		)
	}
})
