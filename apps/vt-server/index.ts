import maplibregl, {
	type CircleLayerSpecification,
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

map.addControl(
	{
		onAdd() {
			const $entity = document.createElement("div")
			$entity.id = "entity"
			$entity.className = "map-control"
			return $entity
		},
		onRemove() {
			const $entity = document.getElementById("entity")
			if ($entity) {
				$entity.remove()
			}
		},
	},
	"bottom-left",
)

map.addControl(
	{
		onAdd() {
			const $info = document.createElement("div")
			$info.id = "info"
			$info.className = "map-control"
			$info.innerHTML = `
            <header>OSMIX VT SERVER DEMO</header>
            <hr />
            <div id="meta">Loading...</div>
            `
			return $info
		},
		onRemove() {
			const $info = document.getElementById("info")
			if ($info) {
				$info.remove()
			}
		},
	},
	"top-left",
)

addLayerControl()

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
<tr><td>node layer</td><td>${meta.nodeLayerName}</td></tr>
<tr><td>way layer</td><td>${meta.wayLayerName}</td></tr>
</tbody>
</table>
    `
	map.on("load", () => {
		console.log("load complete, adding sources and layers")
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
		const $entity = document.getElementById("entity")
		if (!$entity) return
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
	})
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

function addLayerControl() {
	const $layerControl = document.createElement("div")
	$layerControl.className = "map-control"

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

	map.addControl(
		{
			onAdd() {
				map.on("styledata", updateLayerControl)
				map.on("load", updateLayerControl)
				updateLayerControl()
				return $layerControl
			},
			onRemove() {
				//
			},
		},
		"top-right",
	)
}
