import type { OsmInfo } from "@osmix/core"
import { bboxToTileRange } from "@osmix/shared/tile"
import type { OsmTags, Tile } from "@osmix/shared/types"
import * as idb from "idb-keyval"
import maplibregl from "maplibre-gl"
import { createRemote } from "osmix"
import { codeToHtml } from "./shiki.bundle"
import MergeWorkerUrl from "./worker.ts?worker&url"

// Monaco PBF URL - use local fixture in dev, remote in production
const MONACO_URL =
	window.location.hostname === "localhost"
		? "/monaco.pbf"
		: "https://trevorgerhardt.github.io/files/487218b69358-1f24d3e4e476/monaco.pbf"
const MAP_STYLE =
	"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
const MAP_PREVIEW_TILE_SIZE = 128
const MAP_PREVIEW_INITIAL_ZOOM = 16
const MAP_PREVIEW_MAX_TILES = 16
const MAX_SEARCH_RESULTS = 10
const SNAP_RADIUS_METERS = 500
const NO_ROAD_FOUND_MESSAGE = `No road found within ${SNAP_RADIUS_METERS}m. Try clicking closer to a road.`
const ROUTE_SOURCE_ID = "route"
const ROUTE_LAYER_ID = "route"

declare global {
	interface Window {
		loadMonaco: () => Promise<void>
		handleFileSelect: (input: HTMLInputElement) => Promise<void>
		handleSearch: () => Promise<void>
		clearIndexedDB: () => Promise<void>
	}
}

// State
let currentOsmInfo: OsmInfo | null = null

function byId<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null
}

function getErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : "Unknown error"
}

async function loadIntoOsmix(data: ArrayBuffer | File, name: string) {
	currentOsmInfo = await remote.fromPbf(data, { id: name })
	setLoadingStatus(`LOADED FILE: ${name}`)
	enableSearch()
	updateResults()
}

const IDB_PBF_KEY = "osmix-pbf"
const IDB_NAME_KEY = "osmix-pbf-name"
const IDB_MAX_SIZE = 1024 * 1024 * 500 // 500MB

// Initialize osmix remote (single worker for docs)
const remote = await createRemote({
	workerUrl: new URL(MergeWorkerUrl, import.meta.url),
})

// Setup raster protocol
maplibregl.addProtocol(
	"@osmix/vector",
	async (
		req,
		abortController,
	): Promise<maplibregl.GetResourceResponse<ArrayBuffer | null>> => {
		const match = /^@osmix\/vector:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.mvt$/.exec(
			req.url,
		)
		if (!match || !remote) throw new Error(`Bad URL: ${req.url}`)

		const [, osmId, zStr, xStr, yStr] = match
		const tile: Tile = [+xStr, +yStr, +zStr]
		const rasterTile = await remote.getVectorTile(
			decodeURIComponent(osmId),
			tile,
		)

		return { data: abortController.signal.aborted ? null : rasterTile }
	},
)

// Initialize
async function init() {
	// Highlight code examples
	highlightCodeExamples()

	const pbf = await idb.get(IDB_PBF_KEY)
	const name = await idb.get(IDB_NAME_KEY)
	if (pbf && name) {
		setLoadButtonsEnabled(false)
		try {
			setLoadingStatus(`Loading ${name} from IndexedDB cache...`)
			await loadIntoOsmix(pbf, name)
		} finally {
			setLoadButtonsEnabled(true)
		}
	}
}

async function highlightCodeExamples() {
	const codeBlocks =
		document.querySelectorAll<HTMLPreElement>(".highlight-this")

	for (const el of codeBlocks) {
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

async function runLoadAction(action: () => Promise<void>) {
	setLoadButtonsEnabled(false)
	try {
		await action()
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			setLoadingStatus("Load cancelled")
			return
		}
		setLoadingStatus(`Error: ${getErrorMessage(err)}`)
	} finally {
		setLoadButtonsEnabled(true)
	}
}

window.loadMonaco = async () => {
	await runLoadAction(async () => {
		setLoadingStatus("Downloading Monaco PBF...")
		const res = await fetch(MONACO_URL)
		if (!res.ok) throw Error(`Failed to fetch: ${res.status}`)
		const buffer = await res.arrayBuffer()

		await idb.set(IDB_PBF_KEY, buffer)
		await idb.set(IDB_NAME_KEY, "monaco.pbf")

		setLoadingStatus("Loading into Osmix...")
		await loadIntoOsmix(buffer, "monaco.pbf")
	})
}

window.handleFileSelect = async (input: HTMLInputElement) => {
	const file = input.files?.[0]
	if (!file) return

	await runLoadAction(async () => {
		setLoadingStatus(`Loading ${file.name}...`)
		let cachedBuffer: ArrayBuffer | null = null
		if (file.size < IDB_MAX_SIZE) {
			cachedBuffer = await file.arrayBuffer()
			await idb.set(IDB_PBF_KEY, cachedBuffer)
			await idb.set(IDB_NAME_KEY, file.name)
		}
		await loadIntoOsmix(cachedBuffer ?? file, file.name)
	})
	input.value = ""
}

function setLoadingStatus(msg: string) {
	const loadingStatus = byId<HTMLElement>("loading-status")
	if (loadingStatus) loadingStatus.textContent = msg
}

function setLoadButtonsEnabled(enabled: boolean) {
	const monaco = byId<HTMLButtonElement>("load-monaco")
	const file = byId<HTMLInputElement>("file-input-el")
	if (monaco) monaco.disabled = !enabled
	if (file) file.disabled = !enabled
}

function enableSearch() {
	const searchBtn = byId<HTMLButtonElement>("search-btn")
	if (searchBtn) searchBtn.disabled = false
}

function updateResults() {
	if (!currentOsmInfo) return

	// Update stats
	updateStatsResult()

	// Update map
	void updateRasterCanvasMap()

	// Clear search results
	const table = byId<HTMLElement>("search-table")
	const tbody = table?.querySelector("tbody")
	const resultBox = byId<HTMLElement>("search-result")

	if (tbody) tbody.innerHTML = ""
	table?.classList.remove("has-results")
	resultBox?.classList.remove("has-content")

	// Initialize route map
	initRouteMap()
}

function updateStatsResult() {
	if (!currentOsmInfo) return

	const el = byId<HTMLElement>("stats-result")
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

async function updateRasterCanvasMap() {
	if (!currentOsmInfo) return

	const mapResult = byId<HTMLElement>("map-result")
	const canvas = byId<HTMLElement>("map-canvas")
	if (!(canvas instanceof HTMLCanvasElement)) return
	if (mapResult) mapResult.classList.add("has-content")

	const [west, south, east, north] = currentOsmInfo.bbox
	const osmId = currentOsmInfo.id

	const tileRange = choosePreviewTileRange([west, south, east, north])
	const tileColumns = tileRange.maxX - tileRange.minX + 1
	const tileRows = tileRange.maxY - tileRange.minY + 1
	const tileSize = MAP_PREVIEW_TILE_SIZE

	const mosaicCanvas = document.createElement("canvas")
	mosaicCanvas.width = tileColumns * tileSize
	mosaicCanvas.height = tileRows * tileSize
	const mosaicContext = mosaicCanvas.getContext("2d")
	if (!mosaicContext) throw new Error("Failed to get 2d context")

	for (let y = tileRange.minY; y <= tileRange.maxY; y++) {
		for (let x = tileRange.minX; x <= tileRange.maxX; x++) {
			try {
				const tile = await remote.getRasterTile(osmId, [x, y, tileRange.zoom], {
					tileSize,
					lineColor: [15, 23, 42, 255],
				})
				const tx = (x - tileRange.minX) * tileSize
				const ty = (y - tileRange.minY) * tileSize
				mosaicContext.putImageData(
					new ImageData(tile, tileSize, tileSize),
					tx,
					ty,
				)
			} catch (err) {
				console.warn(`Skipping raster tile ${tileRange.zoom}/${x}/${y}:`, err)
			}
		}
	}

	const displayWidth = Math.max(canvas.clientWidth, 1)
	const displayHeight = Math.max(canvas.clientHeight, 1)
	const dpr = window.devicePixelRatio || 1
	canvas.width = Math.round(displayWidth * dpr)
	canvas.height = Math.round(displayHeight * dpr)

	const context = canvas.getContext("2d")
	if (!context) throw new Error("Failed to get 2d context")
	context.setTransform(dpr, 0, 0, dpr, 0, 0)
	context.clearRect(0, 0, displayWidth, displayHeight)

	const scale = Math.min(
		displayWidth / mosaicCanvas.width,
		displayHeight / mosaicCanvas.height,
	)
	const drawWidth = mosaicCanvas.width * scale
	const drawHeight = mosaicCanvas.height * scale
	const offsetX = (displayWidth - drawWidth) / 2
	const offsetY = (displayHeight - drawHeight) / 2
	context.drawImage(mosaicCanvas, offsetX, offsetY, drawWidth, drawHeight)
}

window.handleSearch = async () => {
	if (!currentOsmInfo) return

	const keyInput = byId<HTMLInputElement>("search-key")
	const valueInput = byId<HTMLInputElement>("search-value")
	if (!keyInput || !valueInput) return
	const key = keyInput.value.trim()
	if (!key) return

	const value = valueInput.value.trim() || undefined
	const results = await remote.search(currentOsmInfo.id, key, value)

	const tbody = document.querySelector("#search-table tbody")
	const table = document.getElementById("search-table")
	const resultBox = document.getElementById("search-result")

	if (!tbody || !table || !resultBox) return

	tbody.innerHTML = ""

	// Display up to MAX_SEARCH_RESULTS total
	let count = 0

	// Helper to add a row
	const addRow = (type: string, id: number, tags: OsmTags | undefined) => {
		if (count >= MAX_SEARCH_RESULTS) return false
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

	const groups = [
		["node", results.nodes],
		["way", results.ways],
		["relation", results.relations],
	] as const
	let hasSpace = true
	for (const [type, entities] of groups) {
		for (const entity of entities) {
			hasSpace = addRow(type, entity.id, entity.tags)
			if (!hasSpace) break
		}
		if (!hasSpace) break
	}

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

	const resultBox = byId<HTMLElement>("routing-result")
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
			type: "vector",
			tiles: [`@osmix/vector://${encodeURIComponent(osmId)}/{z}/{x}/{y}.mvt`],
		})
		const wayBaseColorExpression: maplibregl.ExpressionSpecification = [
			"case",
			["has", "color"],
			["to-color", ["get", "color"]],
			["rgba", 255, 255, 255, 1],
		]
		routeMap.addLayer({
			id: "@osmix:ways",
			"source-layer": `@osmix:${osmId}:ways`,
			source: "osmix",
			type: "line",
			paint: {
				"line-color": [
					"case",
					["boolean", ["feature-state", "hover"], false],
					["rgba", 255, 0, 0, 1],
					wayBaseColorExpression,
				],
				"line-opacity": 1,
				"line-width": [
					"interpolate",
					["linear"],
					["zoom"],
					12,
					0.5,
					14,
					2,
					18,
					10,
				],
			},
		})

		// Add click handler for routing
		routeMap.on("click", async (e) => {
			if (!routeMap || !currentOsmInfo) return

			const clickedPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat]
			const osmId = currentOsmInfo.id

			// If both are set, clear and start over
			if (routeOrigin && routeDestination) clearRoute()

			if (!routeOrigin) {
				const snapped = await findNearestRoad(osmId, clickedPoint)
				if (!snapped) {
					return
				}

				routeOrigin = {
					nodeIndex: snapped.nodeIndex,
					coordinates: snapped.coordinates,
				}

				originMarker = addRouteMarker("#00ff00", routeOrigin.coordinates)

				updateRouteTable([
					["Origin", formatCoords(routeOrigin.coordinates)],
					["Snap distance", `${snapped.distance.toFixed(0)} m`],
					["Instructions", "Click on the map to set destination"],
				])
			} else {
				// Set destination and calculate route
				const baseRows: [string, string][] = [
					["Origin", formatCoords(routeOrigin.coordinates)],
				]
				const snapped = await findNearestRoad(osmId, clickedPoint, baseRows)
				if (!snapped) {
					return
				}

				routeDestination = {
					nodeIndex: snapped.nodeIndex,
					coordinates: snapped.coordinates,
				}

				destinationMarker = addRouteMarker(
					"#ff0000",
					routeDestination.coordinates,
				)

				updateRouteTable([
					["Origin", formatCoords(routeOrigin.coordinates)],
					["Destination", formatCoords(routeDestination.coordinates)],
					["Status", "Calculating route..."],
				])

				const result = await remote.route(
					osmId,
					routeOrigin.nodeIndex,
					routeDestination.nodeIndex,
					{ includeStats: true, includePathInfo: true },
				)

				if (!result) {
					updateRouteTable([
						["Origin", formatCoords(routeOrigin.coordinates)],
						["Destination", formatCoords(routeDestination.coordinates)],
						["Error", "No route found. Click to start over."],
					])
					return
				}

				drawRoute(result.coordinates)

				updateRouteTable([
					["Distance", `${((result.distance ?? 0) / 1000).toFixed(2)} km`],
					["Time", `${Math.round((result.time ?? 0) / 60)} min`],
					["Points", `${result.coordinates.length}`],
					["Instructions", "Click to start a new route"],
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
	removeRoutePath()

	// Reset state
	routeOrigin = null
	routeDestination = null
}

function drawRoute(coordinates: [number, number][]) {
	if (!routeMap) return

	// Remove existing route layer
	removeRoutePath()

	// Add route line
	routeMap.addSource(ROUTE_SOURCE_ID, {
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
		id: ROUTE_LAYER_ID,
		type: "line",
		source: ROUTE_SOURCE_ID,
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
	const routeTable = byId<HTMLElement>("route-table")
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

function removeRoutePath() {
	if (!routeMap) return
	if (routeMap.getLayer(ROUTE_LAYER_ID)) routeMap.removeLayer(ROUTE_LAYER_ID)
	if (routeMap.getSource(ROUTE_SOURCE_ID))
		routeMap.removeSource(ROUTE_SOURCE_ID)
}

function addRouteMarker(color: string, coordinates: [number, number]) {
	if (!routeMap) return null
	return new maplibregl.Marker({ color }).setLngLat(coordinates).addTo(routeMap)
}

async function findNearestRoad(
	osmId: string,
	point: [number, number],
	rows: [string, string][] = [],
) {
	updateRouteTable([...rows, ["Status", "Finding nearest road..."]])
	const snapped = await remote.findNearestRoutableNode(
		osmId,
		point,
		SNAP_RADIUS_METERS,
	)
	if (!snapped) {
		updateRouteTable([...rows, ["Error", NO_ROAD_FOUND_MESSAGE]])
		return null
	}
	return {
		nodeIndex: snapped.nodeIndex,
		coordinates: snapped.coordinates as [number, number],
		distance: snapped.distance,
	}
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
}

function formatCoords(coords: [number, number]): string {
	return `${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`
}

/**
 * Calculate an initial tile range for the map preview, lowering zoom if needed.
 */
function choosePreviewTileRange(bbox: [number, number, number, number]) {
	let zoom = MAP_PREVIEW_INITIAL_ZOOM
	let tileRange = bboxToTileRange(bbox, zoom)

	while (tileRange.count > MAP_PREVIEW_MAX_TILES && zoom > 0) {
		zoom -= 0.1
		tileRange = bboxToTileRange(bbox, zoom)
	}

	return { ...tileRange, zoom }
}

// Initialize on load
init()
// Admin functions
if (localStorage.getItem("ADMIN")) {
	document.body.classList.add("ADMIN")
}

window.clearIndexedDB = async () => {
	await idb.clear()
	location.reload()
}

