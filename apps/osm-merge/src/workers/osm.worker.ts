import type { StatusType } from "@/state/log"
import { expose, transfer } from "comlink"
import {
	Osm,
	throttle,
	type GeoBbox2D,
	type OsmChanges,
	type OsmChangeset,
	type OsmMergeOptions,
	type TileIndex,
} from "osm.ts"
import * as Performance from "osm.ts/performance"

const osmWorker = {
	log: (message: string, type: StatusType) =>
		type === "error" ? console.error(message) : console.log(message),
	subscribeToLog(fn: typeof this.log) {
		this.log = fn
	},
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
	clearAllOsm() {
		this.ids = {}
	},
	osm(id: string) {
		if (!this.ids[id]) throw Error(`Osm for ${id} not loaded.`)
		return this.ids[id]
	},
	ids: {} as Record<string, Osm>,
	async initFromPbfData(
		id: string,
		data: ArrayBuffer | ReadableStream<Uint8Array>,
	) {
		const measure = Performance.createMeasure("initializing PBF from data")
		const osm = await Osm.fromPbfData(data, id, (m) => this.log(m, "info"))
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
			return transfer({ bitmap }, [bitmap.buffer])
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
	activeChangeset: null as OsmChangeset | null,
	generateChangeset(
		baseOsmId: string,
		patchOsmId: string,
		options: OsmMergeOptions,
	): OsmChanges {
		const patchOsm = this.osm(patchOsmId)
		const changeset = this.osm(baseOsmId).createChangeset()

		const logEverySecond = throttle(this.log, 1_000)

		if (options.directMerge) {
			this.log("Generating direct changes...", "info")
			changeset.generateDirectChanges(patchOsm)
		}
		if (options.deduplicateNodes) {
			let checkedNodes = 0
			this.log("Deduplicating nodes...", "info")
			for (const node of patchOsm.nodes) {
				checkedNodes++
				changeset.deduplicateOverlappingNodes(node)
				logEverySecond(
					`Node deduplication progress: ${checkedNodes.toLocaleString()} checked, ${changeset.stats.deduplicatedNodes.toLocaleString()} deduplicated, ${changeset.stats.deduplicatedNodesReplaced.toLocaleString()} replaced`,
					"info",
				)
			}
		}
		if (options.createIntersections) {
			let checkedWays = 0
			this.log("Creating intersections...", "info")
			for (const way of patchOsm.ways) {
				checkedWays++
				changeset.handleIntersectingWays(way, patchOsm)
				logEverySecond(
					`Intersection creation progress: ${checkedWays.toLocaleString()} ways checked, ${changeset.stats.intersectionPointsFound.toLocaleString()} intersections created`,
					"info",
				)
			}
		}

		this.activeChangeset = changeset
		return {
			nodes: changeset.nodeChanges,
			ways: changeset.wayChanges,
			relations: changeset.relationChanges,
			stats: changeset.stats,
		}
	},
	applyChanges(newId: string) {
		if (!this.activeChangeset) throw Error("No active changeset")
		const osm = this.activeChangeset.applyChanges(newId)
		this.activeChangeset = null
		this.clearAllOsm()
		this.ids[osm.id] = osm
		return osm.transferables()
	},
}

export type OsmWorker = typeof osmWorker

expose(osmWorker)
