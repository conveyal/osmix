import { Osmix } from "@osmix/core"
import type { OsmixTransferables } from "@osmix/core/src/osmix"
import type { OsmNode, OsmRelation, OsmWay } from "@osmix/json"
import type { Tile } from "@osmix/shared/types"
import { OsmixVtEncoder } from "@osmix/vt"
import * as Comlink from "comlink"

export class VtWorker {
	private osm: Osmix | null = null
	private vt: OsmixVtEncoder | null = null

	async init(transferables: OsmixTransferables) {
		this.osm = new Osmix(transferables)
		this.vt = new OsmixVtEncoder(this.osm)
	}

	getTile(tile: Tile) {
		if (!this.osm || !this.vt) throw new Error("OSM not loaded")
		const tileData = this.vt.getTile(tile)
		return Comlink.transfer(tileData, [tileData])
	}

	getMetadata() {
		if (!this.osm || !this.vt) throw new Error("OSM not loaded")
		return {
			nodeLayerName: this.vt.nodeLayerName,
			wayLayerName: this.vt.wayLayerName,
		}
	}

	search(
		key: string,
		val?: string,
	): { nodes: OsmNode[]; ways: OsmWay[]; relations: OsmRelation[] } {
		const osm = this.osm
		if (!osm || !this.vt) throw Error("OSM not loaded")
		console.log("searching for", key, val)
		const nodes = osm.nodes.search(key, val)
		const ways = osm.ways.search(key, val)
		const relations = osm.relations.search(key, val)
		return { nodes, ways, relations }
	}
}

if (!Bun.isMainThread) {
	Comlink.expose(new VtWorker())
}

export function createVtWorker() {
	const worker = new Worker(new URL("./vt.worker.ts", import.meta.url), {
		type: "module",
	})
	return Comlink.wrap<VtWorker>(worker)
}
