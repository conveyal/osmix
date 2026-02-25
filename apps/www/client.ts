import type { OsmInfo } from "@osmix/core"
import { bboxToTileRange } from "@osmix/shared/tile"
import type { OsmTags, Tile } from "@osmix/shared/types"
import * as idb from "idb-keyval"
import maplibregl from "maplibre-gl"
import { createRemote } from "osmix"
import { codeToHtml } from "./shiki.bundle"
import MergeWorkerUrl from "./worker.ts?worker&url"

const MONACO_URL =
	window.location.hostname === "localhost"
		? "/monaco.pbf"
		: "https://trevorgerhardt.github.io/files/487218b69358-1f24d3e4e476/monaco.pbf"
const MAP_STYLE =
	"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
const IDB_KEY = { PBF: "osmix-pbf", NAME: "osmix-pbf-name" }
const IDB_MAX = 500 * 1024 * 1024

// State
let osm: OsmInfo | null = null
let routeMap: maplibregl.Map | null = null
let routeState: {
	origin?: { nodeIndex: number; coords: [number, number] }
	dest?: { nodeIndex: number; coords: [number, number] }
	markers: maplibregl.Marker[]
} = { markers: [] }

const $ = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T | null

const remote = await createRemote({
	workerUrl: new URL(MergeWorkerUrl, import.meta.url),
})

// Protocol for vector tiles
maplibregl.addProtocol("@osmix/vector", async (params, abort) => {
	const [, id, z, x, y] =
		/^@osmix\/vector:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.mvt$/.exec(params.url) ||
		[]
	if (!id) throw new Error(`Bad URL: ${params.url}`)
	const data = await remote.getVectorTile(decodeURIComponent(id), [
		+x,
		+y,
		+z,
	] as Tile)
	return { data: abort.signal.aborted ? null : data }
})

async function init() {
	// Highlight code
	document
		.querySelectorAll<HTMLElement>(".highlight-this")
		.forEach(async (el) => {
			const html = await codeToHtml(el.textContent ?? "", {
				lang: el.dataset.lang ?? "typescript",
				theme: "github-light",
			})
			if (el.parentElement) el.parentElement.outerHTML = html
		})

	// Admin
	if (localStorage.getItem("ADMIN")) document.body.classList.add("ADMIN")
	$("clear-db-btn")?.addEventListener("click", async () => {
		await idb.clear()
		location.reload()
	})

	// Load handlers
	$("load-monaco")?.addEventListener("click", () =>
		loadAction("Downloading Monaco PBF...", async () => {
			const res = await fetch(MONACO_URL)
			if (!res.ok) throw Error(`Status: ${res.status}`)
			const buf = await res.arrayBuffer()
			await idb.set(IDB_KEY.PBF, buf)
			await idb.set(IDB_KEY.NAME, "monaco.pbf")
			await loadPbf(buf, "monaco.pbf")
		}),
	)

	$("file-input-el")?.addEventListener("change", (e) => {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		loadAction(`Loading ${file.name}...`, async () => {
			let buf: ArrayBuffer | null = null
			if (file.size < IDB_MAX) {
				buf = await file.arrayBuffer()
				await idb.set(IDB_KEY.PBF, buf)
				await idb.set(IDB_KEY.NAME, file.name)
			}
			await loadPbf(buf ?? file, file.name)
			;(e.target as HTMLInputElement).value = ""
		})
	})

	$("search-btn")?.addEventListener("click", search)

	// Restore from IDB
	const [pbf, name] = await Promise.all([
		idb.get(IDB_KEY.PBF),
		idb.get(IDB_KEY.NAME),
	])
	if (pbf && name) {
		loadAction(`Restoring ${name}...`, () => loadPbf(pbf, name))
	}
}

async function loadAction(msg: string, fn: () => Promise<void>) {
	const setEnabled = (v: boolean) => {
		;["load-monaco", "file-input-el"].forEach((id) => {
			const el = $<HTMLInputElement | HTMLButtonElement>(id)
			if (el) el.disabled = !v
		})
	}
	setEnabled(false)
	const status = $("loading-status")
	if (status) status.textContent = msg
	try {
		await fn()
	} catch (e) {
		if (status) status.textContent = `Error: ${e}`
	} finally {
		setEnabled(true)
	}
}

async function loadPbf(data: ArrayBuffer | File, name: string) {
	osm = await remote.fromPbf(data, { id: name })
	const status = $("loading-status")
	if (status) status.textContent = `LOADED FILE: ${name}`
	const searchBtn = $<HTMLButtonElement>("search-btn")
	if (searchBtn) searchBtn.disabled = false

	// Update Stats
	const stats = $("stats-result")
	if (stats && osm) {
		const [w, s, e, n] = osm.bbox
		stats.classList.add("has-content")
		stats.innerHTML = `<dl>${Object.entries({
			File: osm.id,
			Nodes: osm.stats.nodes.toLocaleString(),
			Ways: osm.stats.ways.toLocaleString(),
			Relations: osm.stats.relations.toLocaleString(),
			Bbox: `[${w.toFixed(4)}, ${s.toFixed(4)}, ${e.toFixed(4)}, ${n.toFixed(4)}]`,
		})
			.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
			.join("")}</dl>`
	}

	// Update Map Preview
	renderPreview(osm.bbox, osm.id)

	// Reset Search & Route
	const tbody = document.querySelector("#search-table tbody")
	if (tbody) tbody.innerHTML = ""
	$("search-table")?.classList.remove("has-results")
	$("search-result")?.classList.remove("has-content")
	initRouteMap(osm)
}

async function renderPreview(
	bbox: [number, number, number, number],
	id: string,
) {
	const canvas = $<HTMLCanvasElement>("map-canvas")
	if (!canvas) return
	$("map-result")?.classList.add("has-content")

	let zoom = 16
	let range = bboxToTileRange(bbox, zoom)
	while (range.count > 16 && zoom > 0) {
		zoom -= 0.1
		range = bboxToTileRange(bbox, zoom)
	}

	const size = 128
	const cols = range.maxX - range.minX + 1
	const rows = range.maxY - range.minY + 1
	const mCanvas = document.createElement("canvas")
	mCanvas.width = cols * size
	mCanvas.height = rows * size
	const mCtx = mCanvas.getContext("2d")!

	for (let y = range.minY; y <= range.maxY; y++) {
		for (let x = range.minX; x <= range.maxX; x++) {
			try {
				const tile = await remote.getRasterTile(id, [x, y, zoom], {
					tileSize: size,
					lineColor: [15, 23, 42, 255],
				})
				mCtx.putImageData(
					new ImageData(tile, size, size),
					(x - range.minX) * size,
					(y - range.minY) * size,
				)
			} catch {}
		}
	}

	const dpr = window.devicePixelRatio || 1
	const w = Math.max(canvas.clientWidth, 1)
	const h = Math.max(canvas.clientHeight, 1)
	canvas.width = Math.round(w * dpr)
	canvas.height = Math.round(h * dpr)
	const ctx = canvas.getContext("2d")!
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
	const scale = Math.min(w / mCanvas.width, h / mCanvas.height)
	const dw = mCanvas.width * scale
	const dh = mCanvas.height * scale
	ctx.drawImage(mCanvas, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

async function search() {
	if (!osm) return
	const key = $<HTMLInputElement>("search-key")?.value.trim()
	if (!key) return
	const val = $<HTMLInputElement>("search-value")?.value.trim() || undefined
	const res = await remote.search(osm.id, key, val)

	const tbody = document.querySelector("#search-table tbody")
	if (!tbody) return
	tbody.innerHTML = ""

	let count = 0
	const add = (type: string, id: number, tags?: OsmTags) => {
		if (count++ >= 10) return false
		const tr = document.createElement("tr")
		const tagStr = tags
			? Object.entries(tags)
					.map(([k, v]) => `${k}=${v}`)
					.join(", ")
			: "-"
		tr.innerHTML = `<td>${type}</td><td>${id}</td><td>${tagStr
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")}</td>`
		tbody.appendChild(tr)
		return true
	}

	for (const [t, list] of [
		["node", res.nodes],
		["way", res.ways],
		["relation", res.relations],
	] as const) {
		for (const e of list) if (!add(t, e.id, e.tags)) break
	}

	if (!count) tbody.innerHTML = "<tr><td colspan='3'>No results found</td></tr>"
	$("search-table")?.classList.add("has-results")
	$("search-result")?.classList.add("has-content")
}

function initRouteMap(info: OsmInfo) {
	$("routing-result")?.classList.add("has-content")
	routeMap?.remove()
	routeState = { markers: [] }

	routeMap = new maplibregl.Map({
		container: "route-map",
		style: MAP_STYLE,
		bounds: info.bbox,
		fitBoundsOptions: { padding: 40 },
	})

	routeMap.on("load", () => {
		if (!routeMap) return
		routeMap.addSource("osmix", {
			type: "vector",
			tiles: [`@osmix/vector://${encodeURIComponent(info.id)}/{z}/{x}/{y}.mvt`],
		})
		routeMap.addLayer({
			id: "ways",
			source: "osmix",
			"source-layer": `@osmix:${info.id}:ways`,
			type: "line",
			paint: {
				"line-color": [
					"case",
					["has", "color"],
					["to-color", ["get", "color"]],
					"white",
				],
				"line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 10],
			},
		})
		routeMap.on("click", (e) =>
			handleRouteClick(info.id, [e.lngLat.lng, e.lngLat.lat]),
		)
		updateRouteTable([["Instructions", "Click on the map to set origin"]])
	})
}

async function handleRouteClick(id: string, pt: [number, number]) {
	if (!routeMap) return
	if (routeState.origin && routeState.dest) {
		routeState.markers.forEach((m) => void m.remove())
		routeState.markers = []
		routeState.origin = routeState.dest = undefined
		if (routeMap.getLayer("route")) routeMap.removeLayer("route")
		if (routeMap.getSource("route")) routeMap.removeSource("route")
	}

	const rows: [string, string][] = []
	if (routeState.origin) rows.push(["Origin", fmt(routeState.origin.coords)])
	updateRouteTable([...rows, ["Status", "Finding nearest road..."]])

	const snap = await remote.findNearestRoutableNode(id, pt, 500)
	if (!snap)
		return updateRouteTable([...rows, ["Error", "No road found within 500m."]])

	const coords = snap.coordinates as [number, number]
	const marker = new maplibregl.Marker({
		color: routeState.origin ? "#ff0000" : "#00ff00",
	})
		.setLngLat(coords)
		.addTo(routeMap)
	routeState.markers.push(marker)

	if (!routeState.origin) {
		routeState.origin = { nodeIndex: snap.nodeIndex, coords }
		updateRouteTable([
			["Origin", fmt(coords)],
			["Snap distance", `${snap.distance.toFixed(0)} m`],
			["Instructions", "Click to set destination"],
		])
	} else {
		routeState.dest = { nodeIndex: snap.nodeIndex, coords }
		updateRouteTable([
			["Origin", fmt(routeState.origin.coords)],
			["Destination", fmt(coords)],
			["Status", "Calculating..."],
		])

		const res = await remote.route(
			id,
			routeState.origin.nodeIndex,
			routeState.dest.nodeIndex,
			{ includeStats: true, includePathInfo: true },
		)

		if (!res)
			return updateRouteTable([
				["Origin", fmt(routeState.origin.coords)],
				["Destination", fmt(coords)],
				["Error", "No route found."],
			])

		routeMap.addSource("route", {
			type: "geojson",
			data: {
				type: "Feature",
				geometry: { type: "LineString", coordinates: res.coordinates },
				properties: {},
			},
		})
		routeMap.addLayer({
			id: "route",
			type: "line",
			source: "route",
			layout: { "line-join": "round", "line-cap": "round" },
			paint: { "line-color": "#00ff00", "line-width": 4 },
		})

		const lons = res.coordinates.map((c) => c[0])
		const lats = res.coordinates.map((c) => c[1])
		routeMap.fitBounds(
			[
				[Math.min(...lons), Math.min(...lats)],
				[Math.max(...lons), Math.max(...lats)],
			],
			{ padding: 60 },
		)

		updateRouteTable([
			["Distance", `${((res.distance ?? 0) / 1000).toFixed(2)} km`],
			["Time", `${Math.round((res.time ?? 0) / 60)} min`],
			["Points", `${res.coordinates.length}`],
			["Instructions", "Click to start new route"],
		])
	}
}

function updateRouteTable(rows: [string, string][]) {
	const body = document.querySelector("#route-table tbody")
	if (!body) return
	body.innerHTML = rows
		.map(
			([k, v]) =>
				`<tr><td>${k}</td><td>${v.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td></tr>`,
		)
		.join("")
	$("route-table")?.classList.add("has-results")
}

const fmt = (c: [number, number]) => `${c[1].toFixed(5)}, ${c[0].toFixed(5)}`

init()
