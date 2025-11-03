import { Osmix } from "@osmix/core"
import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import * as Comlink from "comlink"

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

	async init(fileUrl: string) {
		await this.osm.readPbf(Bun.file(fileUrl).stream())
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
			header: this.osm.header as OsmPbfHeaderBlock,
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
