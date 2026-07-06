import { createReadStream, readFileSync } from "node:fs"
import os from "node:os"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"

import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { createRemote, OsmixVtEncoder } from "osmix"

const filename = "monaco.pbf"
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000

const pbfPath = fileURLToPath(
	new URL(`../../fixtures/${filename}`, import.meta.url),
)
const indexHtml = readFileSync(
	fileURLToPath(new URL("./index.html", import.meta.url)),
	"utf8",
)

const log: string[] = []
const workerCount = os.cpus().length
const remote = await createRemote({
	workerCount,
	onProgress: (event) => log.push(event.msg),
})
const dataset = await remote.fromPbf(
	Readable.toWeb(createReadStream(pbfPath)) as ReadableStream,
	{ id: filename },
)

console.log(`Number of VT workers available: ${workerCount}`)

const app = new Hono()

app.get("/", (c) => c.html(indexHtml))
app.get("/index.html", (c) => c.html(indexHtml))

app.get("/ready", async (c) => {
	const ready = await dataset.isReady()
	return c.json({ ready, log })
})

app.get("/meta.json", async (c) => {
	const osm = await dataset.get()
	const bbox = osm.bbox()
	const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
	const vtMetadata = OsmixVtEncoder.layerNames(filename)
	return c.json({ filename, bbox, center, header: osm.header, ...vtMetadata })
})

app.get("/tiles/:z/:x/:y", async (c) => {
	try {
		const url = c.req.url
		console.time(url)
		const { x, y, z } = c.req.param()
		const tile = await dataset.getVectorTile([+x, +y, +z])
		console.timeEnd(url)
		return c.body(tile, 200, {
			"content-type": "application/vnd.mapbox-vector-tile",
		})
	} catch (error) {
		console.error(error)
		return c.json(
			{ error: "Internal server error", message: (error as Error).message },
			500,
		)
	}
})

app.get("/search/:kv", async (c) => {
	const { kv } = c.req.param()
	const [key, val] = kv.split("=", 2)
	console.log("searching for", key, val)
	if (!key) {
		return c.json({ error: "Invalid key", message: "Key is required" }, 400)
	}
	const results = await dataset.search(key, val)
	return c.json(results)
})

app.notFound((c) => c.text("Not found", 404))

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`Vector tile server running at http://localhost:${info.port}`)
})
