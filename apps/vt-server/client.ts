import maplibregl, {
	type CircleLayerSpecification,
	type ControlPosition,
	type LineLayerSpecification,
} from "maplibre-gl"

declare global {
	interface Window {
		MAP: maplibregl.Map
	}
}

const map = new maplibregl.Map({
	container: "map",
	style: "https://tiles.openfreemap.org/styles/positron",
	zoom: 13,
})
window.MAP = map

const $entity = addMapControl("entity", "bottom-left")
const $info = addMapControl("info", "top-left")
const $layerControl = addMapControl("layer-control", "top-right")
$info.innerHTML = `
            <header>OSMIX VT SERVER DEMO</header>
			<p>This page is a demo showing a server parsing the OSM PBF and generating vector tiles on the fly.</p>
			<p>See the code on <a href="https://github.com/conveyal/osmix" target="_blank">GitHub</a></p>
			<hr />
            <div id="meta">Loading...</div>
            `

map.on("styledata", updateLayerControl)

waitForServerReady()

const waysOutlinePaint: LineLayerSpecification["paint"] = {
	"line-color": "#99a1af",
	"line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 14, 3, 18, 15],
	"line-opacity": [
		"case",
		["boolean", ["feature-state", "hover"], false],
		1,
		0.5,
	],
}

const waysPaint: LineLayerSpecification["paint"] = {
	"line-color": [
		"case",
		["boolean", ["feature-state", "hover"], false],
		"#ef4444",
		"#3b82f6",
	],
	"line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 2, 18, 10],
	"line-opacity": [
		"case",
		["boolean", ["feature-state", "hover"], false],
		1,
		0.5,
	],
}

const nodesPaint: CircleLayerSpecification["paint"] = {
	"circle-color": "white",
	"circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 14, 3, 18, 6],
	"circle-stroke-color": ["rgba", 0, 0, 0, 0.5],
	"circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 2],
	"circle-opacity": [
		"case",
		["boolean", ["feature-state", "hover"], false],
		1,
		0.5,
	],
}

const $log = document.getElementById("log")! as HTMLDialogElement
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

async function loadNewOsmMap() {
	const res = await fetch("/meta.json")
	const meta = await res.json()
	map.fitBounds(meta.bbox, {
		padding: 100,
		duration: 200,
	})
	document.getElementById("meta")!.innerHTML = `
<table><tbody>
<tr><td>pbf bbox</td><td>${meta.bbox.join(", ")}</td></tr>
</tbody>
</table>
    `

	function addSourcesAndLayers() {
		console.log("adding sources and layers")
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
		map.on("mouseout", ["@osmix:ways", "@osmix:nodes"], (e) => {
			canvas.style.cursor = ""
		})
	}

	if (map.isStyleLoaded()) {
		addSourcesAndLayers()
	} else {
		map.on("load", addSourcesAndLayers)
	}
}

function featureToHtml(feature: {
	id: string | number | undefined
	properties: Record<string, string>
	geometry: GeoJSON.Geometry
}) {
	const propKeys = Object.keys(feature.properties).sort()
	const html = `
<header>${feature.properties.type}/${feature.id}</header>
<hr />
<table>
<tbody>
${propKeys.map((key) => `<tr><td>${key}</td><td>${feature.properties[key]}</td></tr>`).join("")}
</tbody>
</table>
    `
	return html
}

function updateLayerControl() {
	const layers = map.getLayersOrder().filter(([id]) => id != null)
	const html = `
        <div>
        <header>LAYERS</header>
        <hr />
        ${layers.map((layer) => `<label><input name="${layer}" type="checkbox" ${map.getLayoutProperty(layer, "visibility") !== "none" ? "checked" : ""} /> ${layer}</label>`).join("")}
        </div>
        `
	$layerControl.innerHTML = html
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
