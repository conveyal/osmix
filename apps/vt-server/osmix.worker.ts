import "./decompression-stream-polyfill"
import { Osmix } from "@osmix/core"
import * as Comlink from "comlink"

// Resolve the Monaco fixture path relative to the repo root
const pbfUrl = new URL("../../fixtures/monaco.pbf", import.meta.url)

export class OsmixWorker {
	private isReady = false

	private osm: Osmix
	private log: string[] = []

	constructor() {
		this.osm = new Osmix()
		this.log = ["Thinking..."]

		this.osm.setLogger((msg) => this.log.push(msg))
	}

	ready() {
		return this.isReady
	}

	getLog() {
		return this.log
	}

	async init() {
		await this.osm.readPbf(Bun.file(pbfUrl).stream())
		this.osm.buildSpatialIndexes()
		this.isReady = true
		return this.osm.transferables()
	}

	async getMetadata() {
		if (!this.isReady) throw new Error("OSM not loaded")
		const bbox = this.osm.bbox()
		const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
		return {
			bbox,
			center,
		}
	}
}

if (!Bun.isMainThread) {
	Comlink.expose(new OsmixWorker())
}

export function createOsmixWorker() {
	const worker = new Worker(new URL("./osmix.worker.ts", import.meta.url), {
		type: "module",
	})
	return Comlink.wrap<OsmixWorker>(worker)
}
