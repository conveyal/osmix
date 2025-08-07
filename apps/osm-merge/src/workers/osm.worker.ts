import { Osm, type GeoBbox2D, type TileIndex } from "osm.ts"
import * as Performance from "osm.ts/performance"
import { expose, transfer } from "comlink"
import type { _TileLoadProps } from "@deck.gl/geo-layers"
import { MIN_PICKABLE_ZOOM } from "@/settings"

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
		const osm = new Osm()
		this.ids[id] = osm
		await osm.initFromPbfData(data, onProgress)
		measure()
	},
	bbox(id: string) {
		return this.osm(id).bbox()
	},
	info(id: string) {
		const osm = this.osm(id)
		const bbox = osm.bbox()
		if (!bbox) throw Error("Osm not loaded. No bbox.")
		return {
			bbox,
			nodes: osm.nodes.size,
			ways: osm.ways.size,
			relations: osm.relations.size,
			header: osm.header,
			parsingTimeMs: osm.parsingTimeMs,
		}
	},
	getNode(id: string, index: number) {
		return this.osm(id).nodes.getByIndex(index)
	},
	getWay(id: string, index: number) {
		const way = this.osm(id).ways.getByIndex(index)
		if (!way) return null
		return {
			way,
			nodes: this.osm(id).nodes.getEntitiesById(way.refs),
		}
	},
	async getTileData(
		id: string,
		bbox: GeoBbox2D,
		tileIndex: TileIndex,
		tileSize = 512,
	) {
		const measure = Performance.createMeasure(
			`generating tile data ${tileIndex.z}/${tileIndex.x}/${tileIndex.y}`,
		)
		try {
			if (tileIndex.z < MIN_PICKABLE_ZOOM) {
				const bitmap =
					tileIndex.z < 9
						? this.osm(id).getNodesBitmapForBbox(bbox, tileSize)
						: this.osm(id).getBitmapForBbox(bbox, tileSize)
				return transfer({ bitmap }, [bitmap.buffer])
			}

			const nodeResults = this.osm(id).getNodesInBbox(bbox)
			const wayResults = this.osm(id).getWaysInBbox(bbox)
			return transfer(
				{
					nodes: nodeResults,
					ways: wayResults,
				},
				[
					nodeResults.positions.buffer,
					nodeResults.indexes.buffer,
					wayResults.positions.buffer,
					wayResults.indexes.buffer,
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
