import type { StatusType } from "@/state/log"
import { expose, transfer } from "comlink"
import {
	type GeoBbox2D,
	Osm,
	type OsmChanges,
	OsmChangeset,
	type OsmMergeOptions,
	type TileIndex,
	throttle,
} from "osm.ts"
import * as Performance from "osm.ts/performance"

const osmCache = new Map<string, Osm>()
const changesetCache = new Map<string, OsmChangeset>()

const osmWorker = {
	log: (message: string, type: StatusType = "info") =>
		type === "error" ? console.error(message) : console.log(message),
	subscribeToLog(fn: typeof this.log) {
		this.log = fn
	},
	getEntity(oid: string, eid: string) {
		const osm = osmCache.get(oid)
		if (!osm) throw Error(`Osm for ${oid} not loaded.`)
		return osm.getById(eid)
	},
	async initFromPbfData(
		id: string,
		data: ArrayBuffer | ReadableStream<Uint8Array>,
	) {
		// Clear previous OSM references making it available for garbage collection
		osmCache.delete(id)
		const measure = Performance.createMeasure("initializing PBF from data")
		const osm = await Osm.fromPbfData(data, id, (m) => this.log(m))
		osmCache.set(id, osm)
		measure()
		return osm.transferables()
	},
	async getTileBitmap(
		id: string,
		bbox: GeoBbox2D,
		tileIndex: TileIndex,
		tileSize = 512,
	) {
		const osm = osmCache.get(id)
		if (!osm) throw Error(`Osm for ${id} not loaded.`)
		const measure = Performance.createMeasure(
			`generating tile bitmap ${tileIndex.z}/${tileIndex.x}/${tileIndex.y}`,
		)
		try {
			const bitmap = osm.getBitmapForBbox(bbox, tileSize)
			return transfer({ bitmap }, [bitmap.buffer])
		} finally {
			measure()
		}
	},
	async getTileData(id: string, bbox: GeoBbox2D) {
		const osm = osmCache.get(id)
		if (!osm) throw Error(`Osm for ${id} not loaded.`)
		const measure = Performance.createMeasure(
			`generating nodes and ways within bbox ${bbox.join(", ")}`,
		)
		try {
			const nodeResults = osm.getNodesInBbox(bbox)
			const wayResults = osm.getWaysInBbox(bbox)
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
	dedupeNodesAndWays(id: string) {
		const osm = osmCache.get(id)
		if (!osm) throw Error(`Osm for ${id} not loaded.`)
		const changeset = new OsmChangeset(osm)
		changesetCache.set(id, changeset)
		const logEverySecond = throttle(this.log, 1_000)
		let checkedWays = 0
		let dedpulicatedWays = 0
		for (const wayStats of changeset.deduplicateWays(osm)) {
			checkedWays++
			dedpulicatedWays += wayStats
			logEverySecond(
				`Deduplicating ways: ${checkedWays.toLocaleString()} ways checked, ${dedpulicatedWays.toLocaleString()} ways deduplicated`,
			)
		}
		let checkedNodes = 0
		let dedpulicatedNodes = 0
		for (const nodeStats of changeset.deduplicateNodes(osm)) {
			checkedNodes++
			dedpulicatedNodes += nodeStats
			logEverySecond(
				`Deduplicating nodes: ${checkedNodes.toLocaleString()} nodes checked, ${dedpulicatedNodes.toLocaleString()} nodes deduplicated`,
			)
		}
		return {
			nodes: changeset.nodeChanges,
			ways: changeset.wayChanges,
			relations: changeset.relationChanges,
			stats: changeset.stats,
		}
	},
	generateChangeset(
		baseOsmId: string,
		patchOsmId: string,
		options: OsmMergeOptions,
	): OsmChanges {
		const patchOsm = osmCache.get(patchOsmId)
		if (!patchOsm) throw Error(`Osm for ${patchOsmId} not loaded.`)
		const baseOsm = osmCache.get(baseOsmId)
		if (!baseOsm) throw Error(`Osm for ${baseOsmId} not loaded.`)
		const changeset = new OsmChangeset(baseOsm)

		const logEverySecond = throttle(this.log, 1_000)

		if (options.directMerge) {
			this.log("Generating direct changes...")
			changeset.generateDirectChanges(patchOsm)
		}
		if (options.deduplicateNodes) {
			let checkedNodes = 0
			this.log("Deduplicating nodes...")
			for (const _nodeStats of changeset.deduplicateNodes(baseOsm)) {
				checkedNodes++
				logEverySecond(
					`Node deduplication progress: ${checkedNodes.toLocaleString()} checked, ${changeset.stats.deduplicatedNodes.toLocaleString()} deduplicated, ${changeset.stats.deduplicatedNodesReplaced.toLocaleString()} replaced`,
				)
			}
		}
		if (options.createIntersections) {
			let checkedWays = 0
			this.log("Creating intersections...")

			// This will check if the osm dataset has the way before trying to create intersections for it.
			for (const _wayStats of changeset.generateIntersectionsForWays(
				patchOsm.ways,
			)) {
				checkedWays++
				logEverySecond(
					`Intersection creation progress: ${checkedWays.toLocaleString()} ways checked, ${changeset.stats.intersectionPointsFound.toLocaleString()} intersections created`,
				)
			}
		}

		changesetCache.set(baseOsmId, changeset)
		return {
			nodes: changeset.nodeChanges,
			ways: changeset.wayChanges,
			relations: changeset.relationChanges,
			stats: changeset.stats,
		}
	},
	applyChangesAndReplace(osmId: string) {
		const changeset = changesetCache.get(osmId)
		if (!changeset) throw Error("No active changeset")
		const osm = changeset.applyChanges(osmId)
		changesetCache.delete(osmId)
		osmCache.set(osmId, osm)
		return osm.transferables()
	},
}

export type OsmWorker = typeof osmWorker

expose(osmWorker)
