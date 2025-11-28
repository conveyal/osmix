/**
 * Shortbread Vector Tile Demo Client
 *
 * Uses the server-generated Shortbread style.json to display
 * vector tiles with proper layer styling.
 */
import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import type { GeoBbox2D, LonLat } from "@osmix/shared/types"
import maplibregl, {
	type ControlPosition,
	type MapGeoJSONFeature,
} from "maplibre-gl"

const $log = document.getElementById("log")! as HTMLDialogElement

// Wait for server to be ready before loading the map
waitForServerReady()

async function waitForServerReady() {
	try {
		const res = await fetch("/ready")
		const body = await res.json()
		if (body.ready) {
			$log.remove()
			await loadMap()
		} else {
			if (!$log.open) $log.showModal()
			$log.innerHTML = `
				<header>Loading OSM Data...</header>
				<hr />
				<pre>${body.log.reverse().join("\n")}</pre>
			`
			setTimeout(waitForServerReady, 1_000)
		}
	} catch (error) {
		console.error(`Error loading map: ${error}`)
	}
}

async function loadMap() {
	// Fetch metadata
	const metaRes = await fetch("/meta.json")
	const meta: {
		bbox: GeoBbox2D
		center: LonLat
		filename: string
		header: OsmPbfHeaderBlock
		layerNames: string[]
		nodes: number
		ways: number
		relations: number
	} = await metaRes.json()

	// Create map with the server-generated Shortbread style
	// Use maxBounds with 10% buffer to prevent zooming/panning too far outside the data area
	const [west, south, east, north] = meta.bbox
	const width = east - west
	const height = north - south
	const buffer = 2
	const maxBounds: GeoBbox2D = [
		west - width * buffer,
		south - height * buffer,
		east + width * buffer,
		north + height * buffer,
	]
	const map = new maplibregl.Map({
		container: "map",
		style: "/style.json",
		zoom: 13,
		maxBounds,
		attributionControl: false,
	})

	// Add controls
	const $entity = addMapControl(map, "entity", "bottom-left")
	const $info = addMapControl(map, "info", "top-left")
	const $layerControl = addMapControl(map, "layer-control", "bottom-right")

	// Info panel
	$info.innerHTML = `
		<header>Shortbread VT Demo</header>
		<p style="margin: 0.5rem 0; font-size: 12px;">
			Serving Shortbread-compliant vector tiles using an extended OsmixWorker.
		</p>
		<hr />
		<dl>
			<dt>File</dt>
			<dd>${meta.filename}</dd>
			<dt>Nodes</dt>
			<dd>${meta.nodes.toLocaleString()}</dd>
			<dt>Ways</dt>
			<dd>${meta.ways.toLocaleString()}</dd>
			<dt>Relations</dt>
			<dd>${meta.relations.toLocaleString()}</dd>
			<dt>Layers</dt>
			<dd>${meta.layerNames.length}</dd>
			<dt>BBox</dt>
			<dd>${meta.bbox.map((n) => n.toFixed(4)).join(", ")}</dd>
		</dl>
	`

	// Fit to bounds when style loads
	map.once("load", () => {
		map.fitBounds(meta.bbox, { padding: 50, duration: 500 })
		updateLayerControl(map, $layerControl)
		setupInteraction(map, $entity)
	})

	// Navigation controls
	map.addControl(new maplibregl.NavigationControl(), "top-right")
}

function setupInteraction(map: maplibregl.Map, $entity: HTMLElement) {
	const canvas = map.getCanvas()
	const layers = map.getLayersOrder().filter((id) => {
		if (id.endsWith(":outline")) return false
		return true
	})

	map.on("mousemove", layers, (e) => {
		canvas.style.cursor = "pointer"
		const features = e.features
		if (features && features.length > 0) {
			$entity.innerHTML = features
				.slice(0, 3)
				.map((f) => featureToHtml(f))
				.join("")
		}
	})

	map.on("mouseleave", layers, () => {
		canvas.style.cursor = ""
	})
}

function featureToHtml(feature: MapGeoJSONFeature) {
	const props = feature.properties || {}
	const propKeys = Object.keys(props).sort()
	const rows = propKeys.map(
		(key) => `
			<dt>${key}</dt>
			<dd>${props[key]}</dd>
	`,
	)
	return `
		<header>${feature.layer.id} (${feature.geometry.type})</header>
		<dl>
			${rows.join("")}
		</dl>
	`
}

function updateLayerControl(map: maplibregl.Map, $layerControl: HTMLElement) {
	const layers = map.getLayersOrder()

	// Group layers by source-layer
	const groups: Record<string, string[]> = {}
	for (const layerId of layers) {
		const layer = map.getLayer(layerId)
		if (!layer) continue
		const sourceLayer =
			"source-layer" in layer ? (layer["source-layer"] as string) : "base"
		if (!groups[sourceLayer]) groups[sourceLayer] = []
		groups[sourceLayer].push(layerId)
	}

	let html = "<header>Layers</header><hr />"

	for (const [group, layerIds] of Object.entries(groups)) {
		html += `<div class="layer-group"><div class="layer-group-title">${group}</div>`
		for (const layerId of layerIds) {
			const isVisible = map.getLayoutProperty(layerId, "visibility") !== "none"
			html += `
				<label>
					<input 
						name="${layerId}" 
						type="checkbox" 
						${isVisible ? "checked" : ""} 
					/> ${layerId}
				</label>
			`
		}
		html += "</div>"
	}

	$layerControl.innerHTML = html

	// Add event listeners for checkboxes
	$layerControl.querySelectorAll("input").forEach((input) => {
		input.addEventListener("change", (e) => {
			const target = e.target as HTMLInputElement
			map.setLayoutProperty(
				target.name,
				"visibility",
				target.checked ? "visible" : "none",
			)
		})
	})
}

function addMapControl(
	map: maplibregl.Map,
	id: string,
	placement: ControlPosition,
) {
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
