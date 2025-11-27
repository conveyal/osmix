/**
 * Shortbread Vector Tile Server
 *
 * This demonstrates how to use an extended OsmixWorker with custom
 * functionality (ShortbreadVtEncoder) in a Bun server.
 */
import os from "node:os"
import { ShortbreadVtEncoder } from "@osmix/shortbread"
import type { GeoBbox2D, LonLat } from "@osmix/shared/types"
import type { StyleSpecification } from "maplibre-gl"
import { OsmixRemote } from "osmix"
import type { ShortbreadWorker } from "./shortbread.worker"
import indexHtml from "./index.html"

const filename = "monaco.pbf"
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001

// Resolve the Monaco fixture path relative to the repo root
const pbfUrl = new URL(`../../fixtures/${filename}`, import.meta.url)

const log: string[] = []
const workerCount = os.cpus().length

// Connect with the custom ShortbreadWorker using the workerUrl option
const Osmix = await OsmixRemote.connect<ShortbreadWorker>({
	workerCount,
	workerUrl: new URL("./shortbread.worker.ts", import.meta.url),
	onProgress: (event) => log.push(event.msg),
})

console.log(`Number of Shortbread VT workers available: ${workerCount}`)

const server = Bun.serve({
	port: PORT,
	idleTimeout: 255,
	development: true,
	routes: {
		"/": indexHtml,
		"/index.html": indexHtml,
		"/ready": async () => {
			const ready = await Osmix.isReady(filename)
			return Response.json({ ready, log }, { status: 200 })
		},
		"/meta.json": async () => {
			const osm = await Osmix.get(filename)
			const bbox = osm.bbox()
			const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
			const layerNames = ShortbreadVtEncoder.layerNames
			return Response.json(
				{ filename, bbox, center, header: osm.header, layerNames },
				{ status: 200 },
			)
		},
		"/style.json": async () => {
			const osm = await Osmix.get(filename)
			const bbox = osm.bbox()
			const center: LonLat = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
			const style = createShortbreadStyle(bbox, center)
			return Response.json(style, { status: 200 })
		},
		"/tiles/:z/:x/:y": async (req) => {
			try {
				console.time(req.url)
				// Use the extended worker method via getWorker()
				const tile = await Osmix.getWorker().getShortbreadTile(filename, [
					+req.params.x,
					+req.params.y,
					+req.params.z,
				])
				console.timeEnd(req.url)
				return new Response(tile, {
					headers: {
						"content-type": "application/vnd.mapbox-vector-tile",
						"access-control-allow-origin": "*",
					},
				})
			} catch (error) {
				console.error(error)
				return Response.json(
					{ error: "Internal server error", message: (error as Error).message },
					{ status: 500 },
				)
			}
		},
		"/search/:kv": async (req) => {
			const { kv } = req.params
			const [key, val] = kv.split("=", 2)
			console.log("searching for", key, val)
			if (!key) {
				return Response.json(
					{ error: "Invalid key", message: "Key is required" },
					{ status: 400 },
				)
			}
			const results = await Osmix.search(filename, key, val)
			return Response.json(results, { status: 200 })
		},
	},
	fetch: async () => {
		return new Response("Not found", { status: 404 })
	},
})

console.log(
	`Shortbread vector tile server running at http://localhost:${server.port}`,
)

async function init() {
	await Osmix.fromPbf(Bun.file(pbfUrl.pathname).stream(), { id: filename })
	console.log("Osmix initialized with Shortbread encoder")
}

init()

/**
 * Generate a MapLibre style that renders Shortbread vector tiles.
 */
function createShortbreadStyle(
	bbox: GeoBbox2D,
	center: LonLat,
): StyleSpecification {
	return {
		version: 8,
		name: "Shortbread Demo",
		sources: {
			shortbread: {
				type: "vector",
				tiles: [`http://localhost:${PORT}/tiles/{z}/{x}/{y}`],
				minzoom: 0,
				maxzoom: 22,
				bounds: bbox,
			},
		},
		layers: [
			// Background
			{
				id: "background",
				type: "background",
				paint: { "background-color": "#f8f4f0" },
			},
			// Water polygons
			{
				id: "water",
				type: "fill",
				source: "shortbread",
				"source-layer": "water",
				paint: {
					"fill-color": "#a0c8f0",
					"fill-opacity": 0.8,
				},
			},
			// Land use
			{
				id: "land-forest",
				type: "fill",
				source: "shortbread",
				"source-layer": "land",
				filter: ["in", ["get", "kind"], ["literal", ["forest", "wood"]]],
				paint: {
					"fill-color": "#c8e6c8",
					"fill-opacity": 0.6,
				},
			},
			{
				id: "land-grass",
				type: "fill",
				source: "shortbread",
				"source-layer": "land",
				filter: [
					"in",
					["get", "kind"],
					["literal", ["grass", "meadow", "recreation_ground"]],
				],
				paint: {
					"fill-color": "#d8f0d0",
					"fill-opacity": 0.5,
				},
			},
			{
				id: "land-residential",
				type: "fill",
				source: "shortbread",
				"source-layer": "land",
				filter: ["==", ["get", "kind"], "residential"],
				paint: {
					"fill-color": "#e8e4e0",
					"fill-opacity": 0.4,
				},
			},
			{
				id: "land-commercial",
				type: "fill",
				source: "shortbread",
				"source-layer": "land",
				filter: [
					"in",
					["get", "kind"],
					["literal", ["commercial", "retail", "industrial"]],
				],
				paint: {
					"fill-color": "#f0e8dc",
					"fill-opacity": 0.4,
				},
			},
			// Sites
			{
				id: "sites",
				type: "fill",
				source: "shortbread",
				"source-layer": "sites",
				paint: {
					"fill-color": "#e0f0e0",
					"fill-opacity": 0.4,
				},
			},
			// Buildings
			{
				id: "buildings",
				type: "fill",
				source: "shortbread",
				"source-layer": "buildings",
				minzoom: 13,
				paint: {
					"fill-color": "#d4c8bc",
					"fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.3, 16, 0.7],
				},
			},
			{
				id: "buildings-outline",
				type: "line",
				source: "shortbread",
				"source-layer": "buildings",
				minzoom: 14,
				paint: {
					"line-color": "#b8a898",
					"line-width": 0.5,
				},
			},
			// Water lines
			{
				id: "water-lines",
				type: "line",
				source: "shortbread",
				"source-layer": "water_lines",
				paint: {
					"line-color": "#a0c8f0",
					"line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 4],
				},
			},
			// Streets - casing (outline)
			{
				id: "streets-casing",
				type: "line",
				source: "shortbread",
				"source-layer": "streets",
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": "#999",
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						10,
						["match", ["get", "kind"], ["motorway", "trunk"], 3, ["primary", "secondary"], 2, 1],
						18,
						["match", ["get", "kind"], ["motorway", "trunk"], 24, ["primary", "secondary"], 18, 12],
					],
				},
			},
			// Streets - fill
			{
				id: "streets",
				type: "line",
				source: "shortbread",
				"source-layer": "streets",
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": [
						"match",
						["get", "kind"],
						["motorway", "motorway_link"],
						"#f4a259",
						["trunk", "trunk_link"],
						"#f4c259",
						["primary", "primary_link"],
						"#fcd171",
						["secondary", "secondary_link"],
						"#f9f0cb",
						["tertiary", "tertiary_link"],
						"#fff",
						["residential", "living_street", "unclassified"],
						"#fff",
						["pedestrian", "footway", "path"],
						"#f0e8dc",
						"#eee",
					],
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						10,
						["match", ["get", "kind"], ["motorway", "trunk"], 2, ["primary", "secondary"], 1.5, 0.5],
						18,
						["match", ["get", "kind"], ["motorway", "trunk"], 20, ["primary", "secondary"], 14, 8],
					],
				},
			},
			// Boundary lines
			{
				id: "boundary-lines",
				type: "line",
				source: "shortbread",
				"source-layer": "boundary_lines",
				paint: {
					"line-color": "#8b7b9b",
					"line-width": ["interpolate", ["linear"], ["zoom"], 4, 1, 12, 2],
					"line-dasharray": [3, 2],
				},
			},
			// Street labels
			{
				id: "street-labels",
				type: "symbol",
				source: "shortbread",
				"source-layer": "street_labels",
				minzoom: 13,
				layout: {
					"symbol-placement": "line",
					"text-field": ["get", "name"],
					"text-font": ["Open Sans Regular"],
					"text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 18, 14],
					"text-max-angle": 30,
				},
				paint: {
					"text-color": "#444",
					"text-halo-color": "#fff",
					"text-halo-width": 1.5,
				},
			},
			// Place labels
			{
				id: "place-labels",
				type: "symbol",
				source: "shortbread",
				"source-layer": "places",
				layout: {
					"text-field": ["get", "name"],
					"text-font": ["Open Sans Bold"],
					"text-size": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						["match", ["get", "kind"], ["city", "town"], 14, 10],
						14,
						["match", ["get", "kind"], ["city", "town"], 22, 16],
					],
					"text-anchor": "center",
				},
				paint: {
					"text-color": "#333",
					"text-halo-color": "#fff",
					"text-halo-width": 2,
				},
			},
			// POI labels
			{
				id: "poi-labels",
				type: "symbol",
				source: "shortbread",
				"source-layer": "pois",
				minzoom: 15,
				layout: {
					"text-field": ["get", "name"],
					"text-font": ["Open Sans Regular"],
					"text-size": 11,
					"text-anchor": "top",
					"text-offset": [0, 0.5],
				},
				paint: {
					"text-color": "#666",
					"text-halo-color": "#fff",
					"text-halo-width": 1,
				},
			},
		],
		center,
		zoom: 13,
		glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
	}
}
