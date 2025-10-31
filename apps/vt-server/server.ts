import "./decompression-stream-polyfill" // Required for Bun
import { Osmix } from "@osmix/core"
import { OsmixVtEncoder } from "@osmix/vt"
import indexHtml from "./index.html"

// Resolve the Monaco fixture path relative to the repo root
const pbfUrl = new URL("../../fixtures/monaco.pbf", import.meta.url)
let osm: Osmix | null = null
let vt: OsmixVtEncoder | null = null
let log: string[] = []
let isReady = false

async function loadPbf(pbf: ReadableStream<Uint8Array<ArrayBufferLike>>) {
	isReady = false
	osm = new Osmix()
	vt = new OsmixVtEncoder(osm)
	log = []

	osm.setLogger((msg) => log.push(msg))
	await osm.readPbf(pbf)
	osm.buildSpatialIndexes()
	isReady = true
}

const server = Bun.serve({
	port: process.env.PORT ? Number(process.env.PORT) : 3000,
	development: true,
	routes: {
		"/": indexHtml,
		"/index.html": indexHtml,
		"/api/pbf	": {
			POST: async (req) => {
				const stream = req.body
				if (stream == null) {
					return Response.json({ error: "No body" }, { status: 400 })
				}
				loadPbf(stream)
				return Response.json({ ready: false, log }, { status: 200 })
			},
		},
		"/ready": () => {
			return Response.json({ ready: isReady, log }, { status: 200 })
		},
		"/meta.json": async () => {
			if (osm?.header == null || vt == null) {
				return new Response(null, { status: 202 })
			}
			const bbox = osm.bbox()
			const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
			return Response.json({
				bbox,
				center,
				nodeLayerName: vt.nodeLayerName,
				wayLayerName: vt.wayLayerName,
			})
		},
		"/tiles/:z/:x/:y": async (req) => {
			if (!isReady || vt == null) {
				return new Response(null, { status: 202 })
			}
			console.time(req.url)
			const tile = vt.getTile([+req.params.x, +req.params.y, +req.params.z])
			console.timeEnd(req.url)
			return new Response(tile, {
				headers: {
					"content-type": "application/vnd.mapbox-vector-tile",
				},
			})
		},
	},
	fetch: async () => {
		return new Response("Not found", { status: 404 })
	},
})

console.log(`Vector tile server running at http://localhost:${server.port}`)

loadPbf(Bun.file(pbfUrl).stream())
