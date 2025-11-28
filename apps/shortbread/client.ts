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

let map: maplibregl.Map | null = null

function createLog() {
	document.getElementById("log")?.remove()
	const $log = document.createElement("dialog")
	$log.id = "log"
	$log.innerHTML = `
		<header>OSMMIX SERVER DEMO</header>
		<hr />
		<pre>Loading...</pre>
		<button type="button" disabled>View OSM Tiles</button>
	`
	const $closeLog = $log.querySelector("button")! as HTMLButtonElement
	$closeLog.addEventListener("click", () => $log.close())
	document.body.append($log)
	$log.showModal()
	return $log
}
let $log = createLog()

/**
 * Attach a drop handler to the entire body that POSTs the file to the server
 * and reloads the map.
 */
window.addEventListener("dragover", handleDragOver)
window.addEventListener("dragleave", clearDragShadow)

function handleDragOver(e: DragEvent) {
	if (!e.dataTransfer) return
	const fileItems = [...e.dataTransfer.items].filter(
		(item) => item.kind === "file",
	)
	if (fileItems.length > 0) {
		e.preventDefault()
		if (fileItems.length === 1) {
			document.body.style.boxShadow =
				"inset 0 0 1px 4px rgba(from #3b82f6 r g b / 0.5)"
		} else {
			document.body.style.boxShadow =
				"inset 0 0 1px 4px rgba(from #ef4444 r g b / 0.5)"
		}
	}
}

function clearDragShadow() {
	document.body.style.boxShadow = "none"
}

window.addEventListener("drop", async (e) => {
	e.preventDefault()
	e.stopPropagation()
	clearDragShadow()
	const file = e.dataTransfer?.files[0]
	if (file) {
		if (file.name.endsWith(".pbf")) {
			map?.remove()
			$log = createLog()
			const removeRes = await fetch("/remove")
			if (!removeRes.ok) {
				alert("Error removing current OSM data. Please try again.")
				return
			}
			waitForServerReady()
			const res = await fetch("/pbf", {
				method: "POST",
				body: file,
				headers: {
					"x-filename": file.name,
				},
			})
			if (!res.ok) {
				alert("Error loading PBF file. Please try again.")
				return
			}
		} else {
			alert("Only PBF files are supported. Please try again.")
			return
		}
	}
})

// Wait for server to be ready before loading the map
waitForServerReady()

async function waitForServerReady() {
	try {
		const res = await fetch("/ready")
		const body = await res.json()
		let prevTimestamp = 0
		$log.querySelector("pre")!.textContent = body.log
			.map((l) => {
				if (prevTimestamp === 0) {
					prevTimestamp = l.timestamp
					return `[START] ${l.msg}`
				}
				const duration = l.timestamp - prevTimestamp
				prevTimestamp = l.timestamp
				return `[${(duration / 1_000).toFixed(3)}s] ${l.msg}`
			})
			.reverse()
			.join("\n")
		if (body.ready) {
			await loadMap()
			$log.querySelector("button")!.disabled = false
			$log.close()
		} else {
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
	map = new maplibregl.Map({
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
	const $mapInfoControl = addMapControl(map, "map-info-control", "top-left")

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
		map?.fitBounds(meta.bbox, { padding: 50, duration: 500 })
		updateLayerControl(map!, $layerControl)
		setupInteraction(map!, $entity)
	})

	// Navigation controls
	map.addControl(new maplibregl.NavigationControl(), "top-right")

	const updateMapInfo = () => {
		const zoom = map?.getZoom()
		const center = map?.getCenter()
		if (!zoom || !center) return
		$mapInfoControl.innerHTML = `
			<dl>
				<dt>Zoom</dt>
				<dd>${zoom.toFixed(3)}</dd>
				<dt>Center</dt>
				<dd>${center.lng.toLocaleString()}, ${center.lat.toLocaleString()}</dd>
			</dl>
		`
	}

	// Handle map changes
	map.on("zoom", updateMapInfo)
	map.on("move", updateMapInfo)
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
	console.log(feature)
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
