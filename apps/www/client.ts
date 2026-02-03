import type { OsmInfo } from "@osmix/core"
import type { OsmTags, Tile } from "@osmix/shared/types"
import { get, set } from "idb-keyval"
import maplibregl from "maplibre-gl"
import { createRemote } from "osmix"
import { codeToHtml } from "./shiki.bundle"

// Monaco PBF URL - use local fixture in dev, remote in production
const MONACO_URL =
	window.location.hostname === "localhost"
		? "/monaco.pbf"
		: "https://trevorgerhardt.github.io/files/487218b69358-1f24d3e4e476/monaco.pbf"
const MAP_STYLE =
	"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"

declare global {
	interface Window {
		loadMonaco: () => Promise<void>
		handleFileSelect: (input: HTMLInputElement) => Promise<void>
		handleSearch: () => Promise<void>
	}
}

// State
let currentOsmInfo: OsmInfo | null = null
let map: maplibregl.Map | null = null

const IDB_PBF_KEY = "osmix-pbf"
const IDB_NAME_KEY = "osmix-pbf-name"
const IDB_MAX_SIZE = 1024 * 1024 * 500 // 500MB

// Initialize osmix remote (single worker for docs)
const remote = await createRemote({
	workerUrl: new URL("./worker.ts", import.meta.url),
})

// Setup raster protocol
maplibregl.addProtocol(
	"osmix",
	async (req): Promise<maplibregl.GetResourceResponse<ArrayBuffer>> => {
		const match = /^osmix:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(req.url)
		if (!match || !remote) throw new Error(`Bad URL: ${req.url}`)

		const [, osmId, zStr, xStr, yStr] = match
		const tile: Tile = [+xStr, +yStr, +zStr]
		const rasterTile = await remote.getRasterTile(
			decodeURIComponent(osmId),
			tile,
			256,
		)

		const data = await rasterTileToImageBuffer(rasterTile, 256)
		return { data, cacheControl: "no-store" }
	},
)

// Initialize
async function init() {
	// Highlight code examples
	highlightCodeExamples()

	const pbf = await get(IDB_PBF_KEY)
	const name = await get(IDB_NAME_KEY)
	if (pbf && name) {
		setLoadButtonsEnabled(false)
		try {
			setLoadingStatus(`Loading ${name} from IndexedDB cache...`)
			currentOsmInfo = await remote.fromPbf(pbf, { id: name })
			setLoadingStatus(`${name} loaded`)
			enableSearch()
			updateResults()
		} finally {
			setLoadButtonsEnabled(true)
		}
	}
}

async function highlightCodeExamples() {
	const codeBlocks =
		document.querySelectorAll<HTMLPreElement>(".highlight-this")

	for (const el of codeBlocks) {
		if (el) {
			const html = await codeToHtml(el.textContent ?? "", {
				lang: el.dataset.lang ?? "typescript",
				theme: "github-light",
			})
			const parent = el.parentElement
			if (parent) {
				parent.outerHTML = html
			}
		}
	}
}

window.loadMonaco = async () => {
	setLoadButtonsEnabled(false)
	setLoadingStatus("Downloading Monaco PBF...")

	try {
		const res = await fetch(MONACO_URL)
		if (!res.ok) throw Error(`Failed to fetch: ${res.status}`)
		const buffer = await res.arrayBuffer()

		await set(IDB_PBF_KEY, buffer)
		await set(IDB_NAME_KEY, "monaco.pbf")

		setLoadingStatus("Loading into Osmix...")
		currentOsmInfo = await remote.fromPbf(buffer, { id: "monaco.pbf" })

		setLoadingStatus("monaco.pbf loaded")
		enableSearch()
		updateResults()
	} catch (err) {
		setLoadingStatus(
			`Error: ${err instanceof Error ? err.message : "Unknown error"}`,
		)
	} finally {
		setLoadButtonsEnabled(true)
	}
}

window.handleFileSelect = async (input: HTMLInputElement) => {
	const file = input.files?.[0]
	if (!file) return

	setLoadButtonsEnabled(false)
	setLoadingStatus(`Loading ${file.name}...`)

	try {
		if (file.size < IDB_MAX_SIZE) {
			await set(IDB_PBF_KEY, await file.arrayBuffer())
			await set(IDB_NAME_KEY, file.name)
		}
		currentOsmInfo = await remote.fromPbf(file, { id: file.name })

		setLoadingStatus(`${file.name} loaded`)
		enableSearch()
		updateResults()
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			setLoadingStatus("Load cancelled")
			return
		}
		setLoadingStatus(
			`Error: ${err instanceof Error ? err.message : "Unknown error"}`,
		)
	} finally {
		setLoadButtonsEnabled(true)
		input.value = ""
	}
}

function setLoadingStatus(msg: string) {
	const el = document.getElementById("loading-status")
	if (el) el.textContent = msg
}

function setLoadButtonsEnabled(enabled: boolean) {
	const monaco = document.getElementById("load-monaco") as HTMLButtonElement
	const file = document.getElementById("file-input-el") as HTMLInputElement
	if (monaco) monaco.disabled = !enabled
	if (file) file.disabled = !enabled
}

function enableSearch() {
	const searchBtn = document.getElementById("search-btn") as HTMLButtonElement
	if (searchBtn) searchBtn.disabled = false
}

function updateResults() {
	if (!currentOsmInfo) return

	// Update stats
	updateStatsResult()

	// Update map
	updateMap()

	// Clear search results
	const table = document.getElementById("search-table")
	const tbody = table?.querySelector("tbody")
	const resultBox = document.getElementById("search-result")

	if (tbody) tbody.innerHTML = ""
	table?.classList.remove("has-results")
	resultBox?.classList.remove("has-content")

	// Initialize route map
	initRouteMap()
}

function updateStatsResult() {
	if (!currentOsmInfo) return

	const el = document.getElementById("stats-result")
	if (!el) return

	const [west, south, east, north] = currentOsmInfo.bbox

	el.classList.add("has-content")
	el.innerHTML = `
		<dl>
			<dt>File</dt>
			<dd>${currentOsmInfo.id}</dd>
			<dt>Nodes</dt>
			<dd>${currentOsmInfo.stats.nodes.toLocaleString()}</dd>
			<dt>Ways</dt>
			<dd>${currentOsmInfo.stats.ways.toLocaleString()}</dd>
			<dt>Relations</dt>
			<dd>${currentOsmInfo.stats.relations.toLocaleString()}</dd>
			<dt>Bbox</dt>
			<dd>[${west.toFixed(4)}, ${south.toFixed(4)}, ${east.toFixed(4)}, ${north.toFixed(4)}]</dd>
		</dl>
	`
}

function updateMap() {
	if (!currentOsmInfo) return

	const mapResult = document.getElementById("map-result")
	if (mapResult) mapResult.classList.add("has-content")
	if (map) map.remove()

	const [west, south, east, north] = currentOsmInfo.bbox
	const center: [number, number] = [(west + east) / 2, (south + north) / 2]
	const osmId = currentOsmInfo.id

	map = new maplibregl.Map({
		container: "map",
		style: MAP_STYLE,
		center,
		zoom: 12,
	})

	map.once("load", () => {
		// Add OSM raster layer on top of basemap
		map?.addSource("osmix", {
			type: "raster",
			tiles: [`osmix://${encodeURIComponent(osmId)}/{z}/{x}/{y}`],
			tileSize: 256,
		})
		map?.addLayer({
			id: "osmix",
			type: "raster",
			source: "osmix",
		})

		map?.fitBounds([west, south, east, north], {
			padding: 20,
			duration: 0,
		})
	})
}

window.handleSearch = async () => {
	if (!currentOsmInfo) return

	const keyInput = document.getElementById("search-key") as HTMLInputElement
	const valueInput = document.getElementById("search-value") as HTMLInputElement
	const key = keyInput.value.trim()
	if (!key) return

	const value = valueInput.value.trim() || undefined
	const results = await remote.search(currentOsmInfo.id, key, value)

	const tbody = document.querySelector("#search-table tbody")
	const table = document.getElementById("search-table")
	const resultBox = document.getElementById("search-result")

	if (!tbody || !table || !resultBox) return

	tbody.innerHTML = ""

	// Display up to 10 results total
	let count = 0
	const maxResults = 10

	// Helper to add a row
	const addRow = (type: string, id: number, tags: OsmTags | undefined) => {
		if (count >= maxResults) return false
		const tr = document.createElement("tr")
		const tagsStr = tags
			? Object.entries(tags)
					.map(([k, v]) => `${k}=${v}`)
					.join(", ")
			: "-"
		tr.innerHTML = `
			<td>${type}</td>
			<td>${id}</td>
			<td>${escapeHtml(tagsStr)}</td>
		`
		tbody.appendChild(tr)
		count++
		return true
	}

	for (const entity of results.nodes)
		if (!addRow("node", entity.id, entity.tags)) break
	for (const entity of results.ways)
		if (!addRow("way", entity.id, entity.tags)) break
	for (const entity of results.relations)
		if (!addRow("relation", entity.id, entity.tags)) break

	if (count === 0)
		tbody.innerHTML = "<tr><td colspan='3'>No results found</td></tr>"

	table.classList.add("has-results")
	resultBox.classList.add("has-content")
}

// Routing state
let routeMap: maplibregl.Map | null = null
let routeOrigin: { nodeIndex: number; coordinates: [number, number] } | null =
	null
let routeDestination: {
	nodeIndex: number
	coordinates: [number, number]
} | null = null
let originMarker: maplibregl.Marker | null = null
let destinationMarker: maplibregl.Marker | null = null

function initRouteMap() {
	if (!currentOsmInfo) return

	const resultBox = document.getElementById("routing-result")
	if (resultBox) resultBox.classList.add("has-content")

	// Clear any existing state
	clearRoute()

	// Remove existing map
	routeMap?.remove()

	const [west, south, east, north] = currentOsmInfo.bbox

	const osmId = currentOsmInfo.id

	routeMap = new maplibregl.Map({
		container: "route-map",
		style: MAP_STYLE,
		bounds: [west, south, east, north],
		fitBoundsOptions: { padding: 40 },
	})

	// Add OSM raster layer and click handler after map loads
	routeMap.once("load", () => {
		if (!routeMap) return

		// Add OSM raster layer so users can see the roads
		routeMap.addSource("osmix", {
			type: "raster",
			tiles: [`osmix://${encodeURIComponent(osmId)}/{z}/{x}/{y}`],
			tileSize: 256,
		})
		routeMap.addLayer({
			id: "osmix",
			type: "raster",
			source: "osmix",
		})

		// Add click handler for routing
		routeMap.on("click", async (e) => {
			if (!routeMap || !currentOsmInfo) return

			const clickedPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat]
			const osmId = currentOsmInfo.id

			// State machine: origin -> destination -> clear & new origin
			if (!routeOrigin) {
				// First click: set origin
				updateRouteTable([["Status", "Finding nearest road..."]])

				const snapped = await remote.findNearestRoutableNode(
					osmId,
					clickedPoint,
					500,
				)
				if (!snapped) {
					updateRouteTable([
						[
							"Error",
							"No road found within 500m. Try clicking closer to a road.",
						],
					])
					return
				}

				routeOrigin = {
					nodeIndex: snapped.nodeIndex,
					coordinates: snapped.coordinates as [number, number],
				}

				// Add green origin marker
				originMarker = new maplibregl.Marker({ color: "#00ff00" })
					.setLngLat(routeOrigin.coordinates)
					.addTo(routeMap)

				updateRouteTable([
					[
						"Origin",
						`${routeOrigin.coordinates[1].toFixed(5)}, ${routeOrigin.coordinates[0].toFixed(5)}`,
					],
					["Snap distance", `${snapped.distance.toFixed(0)} m`],
					["Instructions", "Click on the map to set destination"],
				])
			} else if (!routeDestination) {
				// Second click: set destination and calculate route
				updateRouteTable([
					[
						"Origin",
						`${routeOrigin.coordinates[1].toFixed(5)}, ${routeOrigin.coordinates[0].toFixed(5)}`,
					],
					["Status", "Finding nearest road..."],
				])

				const snapped = await remote.findNearestRoutableNode(
					osmId,
					clickedPoint,
					500,
				)
				if (!snapped) {
					updateRouteTable([
						[
							"Origin",
							`${routeOrigin.coordinates[1].toFixed(5)}, ${routeOrigin.coordinates[0].toFixed(5)}`,
						],
						[
							"Error",
							"No road found within 500m. Try clicking closer to a road.",
						],
					])
					return
				}

				routeDestination = {
					nodeIndex: snapped.nodeIndex,
					coordinates: snapped.coordinates as [number, number],
				}

				// Add red destination marker
				destinationMarker = new maplibregl.Marker({ color: "#ff0000" })
					.setLngLat(routeDestination.coordinates)
					.addTo(routeMap)

				updateRouteTable([
					[
						"Origin",
						`${routeOrigin.coordinates[1].toFixed(5)}, ${routeOrigin.coordinates[0].toFixed(5)}`,
					],
					[
						"Destination",
						`${routeDestination.coordinates[1].toFixed(5)}, ${routeDestination.coordinates[0].toFixed(5)}`,
					],
					["Status", "Calculating route..."],
				])

				// Calculate route
				const result = await remote.route(
					osmId,
					routeOrigin.nodeIndex,
					routeDestination.nodeIndex,
					{ includeStats: true, includePathInfo: true },
				)

				if (!result) {
					updateRouteTable([
						[
							"Origin",
							`${routeOrigin.coordinates[1].toFixed(5)}, ${routeOrigin.coordinates[0].toFixed(5)}`,
						],
						[
							"Destination",
							`${routeDestination.coordinates[1].toFixed(5)}, ${routeDestination.coordinates[0].toFixed(5)}`,
						],
						["Error", "No route found. Click to start over."],
					])
					return
				}

				// Draw route on map
				drawRoute(result.coordinates)

				// Display route details
				updateRouteTable([
					["Distance", `${((result.distance ?? 0) / 1000).toFixed(2)} km`],
					["Time", `${Math.round((result.time ?? 0) / 60)} min`],
					["Points", `${result.coordinates.length}`],
					["Instructions", "Click to start a new route"],
				])
			} else {
				// Third click: clear and start new origin
				clearRoute()

				// Now set new origin
				updateRouteTable([["Status", "Finding nearest road..."]])

				const snapped = await remote.findNearestRoutableNode(
					osmId,
					clickedPoint,
					500,
				)
				if (!snapped) {
					updateRouteTable([
						[
							"Error",
							"No road found within 500m. Try clicking closer to a road.",
						],
					])
					return
				}

				routeOrigin = {
					nodeIndex: snapped.nodeIndex,
					coordinates: snapped.coordinates as [number, number],
				}

				// Add green origin marker
				originMarker = new maplibregl.Marker({ color: "#00ff00" })
					.setLngLat(routeOrigin.coordinates)
					.addTo(routeMap)

				updateRouteTable([
					[
						"Origin",
						`${routeOrigin.coordinates[1].toFixed(5)}, ${routeOrigin.coordinates[0].toFixed(5)}`,
					],
					["Snap distance", `${snapped.distance.toFixed(0)} m`],
					["Instructions", "Click on the map to set destination"],
				])
			}
		})

		// Show initial instructions
		updateRouteTable([["Instructions", "Click on the map to set origin"]])
	})
}

function clearRoute() {
	// Remove markers
	originMarker?.remove()
	destinationMarker?.remove()
	originMarker = null
	destinationMarker = null

	// Remove route layer if it exists
	if (routeMap?.getLayer("route")) {
		routeMap.removeLayer("route")
	}
	if (routeMap?.getSource("route")) {
		routeMap.removeSource("route")
	}

	// Reset state
	routeOrigin = null
	routeDestination = null
}

function drawRoute(coordinates: [number, number][]) {
	if (!routeMap) return

	// Remove existing route layer
	if (routeMap.getLayer("route")) {
		routeMap.removeLayer("route")
	}
	if (routeMap.getSource("route")) {
		routeMap.removeSource("route")
	}

	// Add route line
	routeMap.addSource("route", {
		type: "geojson",
		data: {
			type: "Feature",
			properties: {},
			geometry: {
				type: "LineString",
				coordinates,
			},
		},
	})

	routeMap.addLayer({
		id: "route",
		type: "line",
		source: "route",
		layout: {
			"line-join": "round",
			"line-cap": "round",
		},
		paint: {
			"line-color": "#00ff00",
			"line-width": 4,
		},
	})

	// Fit to route bounds
	const lons = coordinates.map((c) => c[0])
	const lats = coordinates.map((c) => c[1])
	routeMap.fitBounds(
		[
			[Math.min(...lons), Math.min(...lats)],
			[Math.max(...lons), Math.max(...lats)],
		],
		{ padding: 60, duration: 500 },
	)
}

function updateRouteTable(rows: [string, string][]) {
	const routeTable = document.getElementById("route-table")
	const routeTableBody = routeTable?.querySelector("tbody")
	if (!routeTableBody || !routeTable) return

	routeTableBody.innerHTML = ""
	for (const [label, value] of rows) {
		const tr = document.createElement("tr")
		tr.innerHTML = `<td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td>`
		routeTableBody.appendChild(tr)
	}

	routeTable.classList.add("has-results")
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
}

/**
 * Convert raster tile data to PNG image buffer.
 */
async function rasterTileToImageBuffer(
	imageData: Uint8ClampedArray<ArrayBuffer>,
	tileSize: number,
): Promise<ArrayBuffer> {
	const canvas = new OffscreenCanvas(tileSize, tileSize)
	const ctx = canvas.getContext("2d")
	if (!ctx) throw new Error("Failed to get 2d context")
	ctx.putImageData(new ImageData(imageData, tileSize, tileSize), 0, 0)
	const blob = await canvas.convertToBlob({ type: "image/png" })
	return blob.arrayBuffer()
}

// Initialize on load
init()
