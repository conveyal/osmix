/**
 * Shortbread Vector Tile Server
 *
 * This demonstrates how to use an extended OsmixWorker with custom
 * functionality (ShortbreadVtEncoder) in a Node server.
 */

import { createReadStream, readFileSync } from "node:fs"
import os from "node:os"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"

import { serve } from "@hono/node-server"
import type { Progress } from "@osmix/shared/progress"
import { ShortbreadVtEncoder } from "@osmix/shortbread"
import * as Versatiles from "@versatiles/style"
import { Hono } from "hono"
import type { StyleSpecification } from "maplibre-gl"
import { createRemote } from "osmix"

import type { ShortbreadWorker } from "./shortbread.worker"

let filename = "monaco.pbf"
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001

const pbfPath = fileURLToPath(
	new URL(`../../fixtures/${filename}`, import.meta.url),
)
const indexHtml = readFileSync(
	fileURLToPath(new URL("./index.html", import.meta.url)),
	"utf8",
)

let log: Progress[] = []
const workerCount = os.cpus().length

const remote = await createRemote<ShortbreadWorker>({
	workerCount,
	workerUrl: new URL("./shortbread.worker.ts", import.meta.url),
	onProgress: (event) => log.push(event),
})

console.log(`Number of workers available: ${workerCount}`)
let dataset = await remote.fromPbf(
	Readable.toWeb(createReadStream(pbfPath)) as ReadableStream,
	{ id: filename },
)

const app = new Hono()

app.get("/", (c) => c.html(indexHtml))
app.get("/index.html", (c) => c.html(indexHtml))

app.get("/remove", async (c) => {
	await dataset.delete()
	log = []
	return c.json({ status: "Removed" })
})

app.post("/pbf", async (c) => {
	try {
		const id = c.req.header("x-filename") ?? "new.pbf"
		const data = c.req.raw.body
		if (!data) {
			return c.json({ error: "No file data provided" }, 400)
		}
		filename = id
		dataset = await remote.fromPbf(data, { id })
		return c.json({ status: `Loading ${id}...` })
	} catch (error) {
		console.error(error)
		return c.json(
			{ error: "Internal server error", message: (error as Error).message },
			500,
		)
	}
})

app.get("/ready", async (c) => {
	const ready = await dataset.isReady()
	return c.json({ ready, log })
})

app.get("/meta.json", async (c) => {
	const osm = await dataset.get()
	const bbox = osm.bbox()
	const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
	const layerNames = ShortbreadVtEncoder.layerNames
	return c.json({
		filename,
		bbox,
		center,
		header: osm.header,
		layerNames,
		nodes: osm.nodes.size,
		ways: osm.ways.size,
		relations: osm.relations.size,
	})
})

app.get("/style.json", async (c) => {
	const style: StyleSpecification = Versatiles.colorful({
		tiles: [`http://localhost:${PORT}/tiles/{z}/{x}/{y}`],
		recolor: {
			gamma: 2,
			tint: 1,
			tintColor: "#3b82f6",
		},
	})
	style.layers = style.layers.filter((layer) => layer.id !== "background")

	style.layers.forEach((layer) => {
		if (!layer.paint) return
		if (layer.minzoom) layer.minzoom -= 2
		if (layer.type === "line") {
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
	return c.json(style)
})

app.get("/tiles/:z/:x/:y", async (c) => {
	try {
		const url = c.req.url
		console.time(url)
		const { x, y, z } = c.req.param()
		const tile = await remote
			.getWorker()
			.getShortbreadTile(dataset.id, [+x, +y, +z])
		console.timeEnd(url)
		return c.body(tile, 200, {
			"content-type": "application/vnd.mapbox-vector-tile",
			"access-control-allow-origin": "*",
		})
	} catch (error) {
		console.error(error)
		return c.json(
			{ error: "Internal server error", message: (error as Error).message },
			500,
		)
	}
})

app.notFound((c) => c.text("Not found", 404))

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(
		`Shortbread vector tile server running at http://localhost:${info.port}`,
	)
	console.log("Osmix initialized with Shortbread encoder")
})
