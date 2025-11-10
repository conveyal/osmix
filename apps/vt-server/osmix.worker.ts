import { type Osmix, osmixFromPbf } from "@osmix/core"
import type { OsmPbfHeaderBlock } from "@osmix/pbf"
import * as Comlink from "comlink"

export class OsmixWorker {
	private osm: Osmix | null = null
	private log: string[] = []

	constructor() {
		this.log = ["Thinking..."]
	}

	ready() {
		return this.osm?.isReady() === true
	}

	getLog() {
		return this.log
	}

	async init(fileUrl: string) {
		this.osm = null
		this.osm = await osmixFromPbf(Bun.file(fileUrl).stream(), {
			logger: (msg) => this.log.push(msg),
		})
		return this.osm.transferables()
	}

	async getMetadata() {
		if (!this.ready() || !this.osm) throw new Error("OSM not loaded")
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
