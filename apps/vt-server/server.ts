import os from "node:os"
import type { Remote } from "comlink"
import indexHtml from "./index.html"
import { createOsmixWorker } from "./osmix.worker"
import { createVtWorker, type VtWorker } from "./vt.worker"

const filename = "monaco.pbf"

// Resolve the Monaco fixture path relative to the repo root
const pbfUrl = new URL(`../../fixtures/${filename}`, import.meta.url)

const Osmix = createOsmixWorker()
const vts: Remote<VtWorker>[] = []
for (let i = 0; i < os.cpus().length; i++) {
	vts.push(createVtWorker())
}
let vtIndex = 0
const getVt = () => vts[vtIndex++ % vts.length]

// Print number of VT workers available
console.log(`Number of VT workers available: ${vts.length}`)

const server = Bun.serve({
	port: process.env.PORT ? Number(process.env.PORT) : 3000,
	idleTimeout: 255, // 5 minutes
	development: true,
	routes: {
		"/": indexHtml,
		"/index.html": indexHtml,
		"/ready": async () => {
			const ready = await Osmix.ready()
			const log = await Osmix.getLog()
			return Response.json({ ready, log }, { status: 200 })
		},
		"/meta.json": async () => {
			const metadata = await Osmix.getMetadata()
			const vtMetadata = await getVt().getMetadata()
			return Response.json(
				{ filename, ...metadata, ...vtMetadata },
				{ status: 200 },
			)
		},
		"/tiles/:z/:x/:y": async (req) => {
			try {
				console.time(req.url)
				const tile = await getVt().getTile([
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
			const results = await getVt().search(key, val)
			return Response.json(results, { status: 200 })
		},
	},
	fetch: async () => {
		return new Response("Not found", { status: 404 })
	},
})

console.log(`Vector tile server running at http://localhost:${server.port}`)

async function init() {
	const transferables = await Osmix.init(pbfUrl.pathname)
	for (const vt of vts) {
		await vt.init(transferables)
	}
	console.log("VTs initialized")
}

init()
