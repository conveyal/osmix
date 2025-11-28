/**
 * Shortbread Vector Tile Server
 *
 * This demonstrates how to use an extended OsmixWorker with custom
 * functionality (ShortbreadVtEncoder) in a Bun server.
 */

import os from "node:os"
import { ShortbreadVtEncoder } from "@osmix/shortbread"
import * as Versatiles from "@versatiles/style"
import type { StyleSpecification } from "maplibre-gl"
import { OsmixRemote } from "osmix"
import indexHtml from "./index.html"
import type { ShortbreadWorker } from "./shortbread.worker"

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
			style.layers = style.layers.filter((layer) => layer.id !== "background")
			return Response.json(style, { status: 200 })
		},
		"/tiles/:z/:x/:y": async (req) => {
			try {
				console.time(req.url)
				req.signal
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
