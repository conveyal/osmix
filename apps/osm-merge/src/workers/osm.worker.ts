import type { Osm, GeoBbox2D, TileIndex } from "osm.ts"
import * as Performance from "osm.ts/performance"
import { expose, transfer } from "comlink"
import type { _TileLoadProps } from "@deck.gl/geo-layers"
import { createOsmIndexFromPbfData } from "../../../../packages/osm.ts/src/osm-from-pbf"

const osmWorker = {
	subscribeToPerformanceObserver(
		onEntry: (
			entryType: string,
			name: string,
			startTime: number,
			duration: number,
			detail: unknown | undefined,
			timeOrigin: number,
		) => void,
	) {
		// Create once; batch each observer callback
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				onEntry(
					entry.entryType,
					entry.name,
					entry.startTime,
					entry.duration,
					"detail" in entry ? entry.detail : undefined,
					performance.timeOrigin,
				)
			}
		})

		observer.observe({ entryTypes: ["mark", "measure"] })
	},
	osm(id: string) {
		if (!this.ids[id]) throw Error("Osm not loaded.")
		return this.ids[id]
	},
	ids: {} as Record<string, Osm>,
	async initFromPbfData(
		id: string,
		data: ArrayBuffer | ReadableStream<Uint8Array>,
		onProgress: (...args: string[]) => void,
	) {
		// By default, delete all existing OSM instances
		for (const id in this.ids) {
			delete this.ids[id]
		}
		const measure = Performance.createMeasure("initializing PBF from data")
		const osm = await createOsmIndexFromPbfData(data, onProgress)
		this.ids[id] = osm
		measure()
		return this.ids[id].transferables()
	},
	async getTileBitmap(
		id: string,
		bbox: GeoBbox2D,
		tileIndex: TileIndex,
		tileSize = 512,
	) {
		const measure = Performance.createMeasure(
			`generating tile bitmap ${tileIndex.z}/${tileIndex.x}/${tileIndex.y}`,
		)
		try {
			const bitmap = this.osm(id).getBitmapForBbox(bbox, tileSize)
			return transfer(bitmap, [bitmap.buffer])
		} finally {
			measure()
		}
	},
	async getTileData(id: string, bbox: GeoBbox2D) {
		const measure = Performance.createMeasure(
			`generating nodes and ways within bbox ${bbox.join(", ")}`,
		)
		try {
			const nodeResults = this.osm(id).getNodesInBbox(bbox)
			const wayResults = this.osm(id).getWaysInBbox(bbox)
			return transfer(
				{
					nodes: nodeResults,
					ways: wayResults,
				},
				[
					nodeResults.positions.buffer,
					nodeResults.ids.buffer,
					wayResults.positions.buffer,
					wayResults.ids.buffer,
					wayResults.startIndices.buffer,
				],
			)
		} catch (e) {
			console.error(e)
			throw e
		} finally {
			measure()
		}
	},
}

export type OsmWorker = typeof osmWorker

expose(osmWorker)
