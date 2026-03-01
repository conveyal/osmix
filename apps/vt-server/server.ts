import os from "node:os"
import { createRemote, OsmixVtEncoder } from "osmix"
import indexHtml from "./index.html"

const filename = "monaco.pbf"

// Resolve the Monaco fixture path relative to the repo root
const pbfUrl = new URL(`../../fixtures/${filename}`, import.meta.url)

const log: string[] = []
const workerCount = os.cpus().length
const remote = await createRemote({
	workerCount,
	onProgress: (event) => log.push(event.msg),
})
let dataset = await remote.fromPbf(Bun.file(pbfUrl.pathname).stream(), { id: filename })

// Print number of VT workers available
console.log(`Number of VT workers available: ${workerCount}`)

const server = Bun.serve({
	port: process.env.PORT ? Number(process.env.PORT) : 3000,
	idleTimeout: 255, // 5 minutes
	development: true,
	routes: {
		"/": indexHtml,
		"/index.html": indexHtml,
		"/ready": async () => {
			const ready = await dataset.isReady()
			return Response.json({ ready, log }, { status: 200 })
		},
		"/meta.json": async () => {
			const osm = await dataset.get()
			const bbox = osm.bbox()
			const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
			const vtMetadata = OsmixVtEncoder.layerNames(filename)
			return Response.json(
				{ filename, bbox, center, header: osm.header, ...vtMetadata },
				{ status: 200 },
			)
		},
		"/tiles/:z/:x/:y": async (req) => {
			try {
				console.time(req.url)
				const tile = await dataset.getVectorTile([
					+req.params.x,
					+req.params.y,
					+req.params.z,
				])
				console.timeEnd(req.url)
				return new Response(tile, {
					headers: {
						"content-type": "application/vnd.mapbox-vector-tile",
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
					{
						error: "Invalid key",
						message: "Key is required",
					},
					{ status: 400 },
				)
			}
			const results = await dataset.search(key, val)
			return Response.json(results, { status: 200 })
		},
	},
	fetch: async () => {
		return new Response("Not found", { status: 404 })
	},
})

console.log(`Vector tile server running at http://localhost:${server.port}`)

