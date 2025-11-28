/**
 * Shortbread Vector Tile Server
 *
 * This demonstrates how to use an extended OsmixWorker with custom
 * functionality (ShortbreadVtEncoder) in a Bun server.
 */

import os from "node:os"
import type { Progress } from "@osmix/shared/progress"
import { ShortbreadVtEncoder } from "@osmix/shortbread"
import * as Versatiles from "@versatiles/style"
import type { StyleSpecification } from "maplibre-gl"
import { OsmixRemote } from "osmix"
import indexHtml from "./index.html"
import type { ShortbreadWorker } from "./shortbread.worker"

let filename = "monaco.pbf"
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001

// Resolve the Monaco fixture path relative to the repo root
const pbfUrl = new URL(`../../fixtures/${filename}`, import.meta.url)

let log: Progress[] = []
const workerCount = os.cpus().length

// Connect with the custom ShortbreadWorker using the workerUrl option
const Osmix = await OsmixRemote.connect<ShortbreadWorker>({
	workerCount,
	workerUrl: new URL("./shortbread.worker.ts", import.meta.url),
	onProgress: (event) => log.push(event),
})

console.log(`Number of workers available: ${workerCount}`)

const server = Bun.serve({
	port: PORT,
	idleTimeout: 255,
	development: true,
	routes: {
		"/": indexHtml,
		"/index.html": indexHtml,
		"/remove": async () => {
			await Osmix.delete(filename)
			// Clear the log
			log = []
			return Response.json({ status: "Removed" }, { status: 200 })
		},
		"/pbf": {
			async POST(req) {
				try {
					const id = req.headers.get("x-filename") ?? "new.pbf"
					const data = req.body
					if (!data) {
						return Response.json(
							{ error: "No file data provided" },
							{ status: 400 },
						)
					}
					// Set the new current filename
					filename = id
					await Osmix.fromPbf(data, { id })
					return Response.json(
						{
							status: `Loading ${id}...`,
						},
						{ status: 200 },
					)
				} catch (error) {
					console.error(error)
					return Response.json(
						{
							error: "Internal server error",
							message: (error as Error).message,
						},
						{ status: 500 },
					)
				}
			},
		},
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
				{
					filename,
					bbox,
					center,
					header: osm.header,
					layerNames,
					nodes: osm.nodes.size,
					ways: osm.ways.size,
					relations: osm.relations.size,
				},
				{ status: 200 },
			)
		},
		"/style.json": async () => {
			const style: StyleSpecification = Versatiles.colorful({
				tiles: [`http://localhost:${PORT}/tiles/{z}/{x}/{y}`],
				recolor: {
					gamma: 2,
					tint: 1,
					tintColor: "#3b82f6",
				},
			})
			// Remove the background layer
			style.layers = style.layers.filter((layer) => layer.id !== "background")

			// Remove opacity stops for line layers
			style.layers.forEach((layer) => {
				if (!layer.paint) return
				if (layer.minzoom) layer.minzoom -= 2
				if (layer.type === "line") {
					// Always show line layers
					delete layer.minzoom

					if (
						"line-opacity" in layer.paint &&
						typeof layer.paint["line-opacity"] === "object"
					) {
						layer.paint["line-opacity"] = 1
					}
					if (
						"line-width" in layer.paint &&
						typeof layer.paint["line-width"] === "object" &&
						"stops" in layer.paint["line-width"] &&
						layer.paint["line-width"].stops[0][1] < 1
					) {
						layer.paint["line-width"].stops[0][1] = 1
					}
				}
				if (layer.type === "fill") {
					// Always show fill layers
					delete layer.minzoom
					if (
						"fill-opacity" in layer.paint &&
						typeof layer.paint["fill-opacity"] === "object" &&
						"stops" in layer.paint["fill-opacity"] &&
						layer.paint["fill-opacity"].stops[0][1] < 1
					) {
						layer.paint["fill-opacity"].stops[0][1] = 1
					}
				}
				if (
					"icon-opacity" in layer.paint &&
					typeof layer.paint["icon-opacity"] === "object"
				) {
					layer.paint["icon-opacity"] = 1
				}
				if (
					"text-opacity" in layer.paint &&
					typeof layer.paint["text-opacity"] === "object"
				) {
					layer.paint["text-opacity"] = 1
				}
			})
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
	},
	fetch: async (_req) => {
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
