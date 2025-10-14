import {
	merge,
	type OsmChangeTypes,
	type OsmixChange,
	OsmixChangeset,
	type OsmixMergeOptions,
} from "@osmix/change"
import { Osmix, throttle } from "@osmix/core"
import type { GeoBbox2D, OsmEntityType } from "@osmix/json"
import { OsmixRasterTile, type TileIndex } from "@osmix/raster"
import { expose, transfer, wrap } from "comlink"
import { dequal } from "dequal/lite"
import { MIN_NODE_ZOOM, RASTER_TILE_SIZE } from "@/settings"
import type { StatusType } from "@/state/log"

export class OsmixWorker {
	private osmixes = new Map<string, Osmix>()

	private changesets = new Map<string, OsmixChangeset>()
	private changeTypes: OsmChangeTypes[] = ["create", "modify", "delete"]
	private entityTypes: OsmEntityType[] = ["node", "way", "relation"]
	private filteredChanges = new Map<string, OsmixChange[]>()

	private log = (message: string, type?: StatusType) => {
		type === "error" ? console.error(message) : console.log(message)
	}
	private logEverySecond = throttle(this.log, 1_000)

	async fromPbf(id: string, data: ArrayBufferLike | ReadableStream) {
		const osm = await Osmix.fromPbf(data, { id, logger: this.log })
		this.osmixes.set(id, osm)
		return osm.transferables()
	}

	setLogger(logger: typeof this.log) {
		this.log = logger
		this.logEverySecond = throttle(this.log, 1_000)
	}

	getEntity(oid: string, eid: string) {
		const osm = this.osmixes.get(oid)
		if (!osm) throw Error(`Osm for ${oid} not loaded.`)
		return osm.getById(eid)
	}

	async getTileImage(
		id: string,
		bbox: GeoBbox2D,
		tileIndex: TileIndex,
		tileSize = RASTER_TILE_SIZE,
	) {
		const osm = this.osmixes.get(id)
		if (!osm) throw Error(`Osm for ${id} not loaded.`)

		const rasterTile = new OsmixRasterTile(bbox, tileIndex, tileSize)
		const timer = `OsmixRasterTile.drawWays:${tileIndex.z}/${tileIndex.x}/${tileIndex.y}`
		console.time(timer)
		osm.ways.intersects(bbox, (wayIndex) => {
			rasterTile.drawWay(osm.ways.getCoordinates(wayIndex, osm.nodes))
			return false
		})
		console.timeEnd(timer)

		if (tileIndex.z >= MIN_NODE_ZOOM) {
			const timer = `OsmixRasterTile.drawNodes:${tileIndex.z}/${tileIndex.x}/${tileIndex.y}`
			console.time(timer)
			const nodeCandidates = osm.nodes.withinBbox(bbox)

			for (const nodeIndex of nodeCandidates) {
				if (!osm.nodes.tags.hasTags(nodeIndex)) continue
				rasterTile.setLonLat(osm.nodes.getNodeLonLat({ index: nodeIndex }))
			}
			console.timeEnd(timer)
		}

		const data = await rasterTile.toImageBuffer()
		return transfer({ data }, [data])
	}

	async getTileData(id: string, bbox: GeoBbox2D) {
		const osm = this.osmixes.get(id)
		if (!osm) throw Error(`Osm for ${id} not loaded.`)
		try {
			const nodes = osm.getNodesInBbox(bbox)
			const ways = osm.getWaysInBbox(bbox)
			const buffers = [
				nodes.positions.buffer,
				nodes.ids.buffer,
				ways.positions.buffer,
				ways.ids.buffer,
				ways.startIndices.buffer,
			]
			return transfer({ nodes, ways }, buffers)
		} catch (e) {
			console.error(e)
			throw e
		}
	}

	async merge(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmixMergeOptions> = {},
	) {
		const baseOsm = this.osmixes.get(baseOsmId)
		if (!baseOsm) throw Error(`Osm for ${baseOsmId} not loaded.`)
		const patchOsm = this.osmixes.get(patchOsmId)
		if (!patchOsm) throw Error(`Osm for ${patchOsmId} not loaded.`)
		const mergedOsm = await merge(baseOsm, patchOsm, options)

		// Replace the base OSM with the merged OSM
		this.osmixes.set(baseOsmId, mergedOsm)

		// Delete the patch OSM
		this.osmixes.delete(patchOsmId)

		// Delete the changeset
		this.changesets.delete(baseOsmId)
		this.filteredChanges.delete(baseOsmId)

		return mergedOsm.transferables()
	}

	generateChangeset(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmixMergeOptions> = {},
	) {
		const patchOsm = this.osmixes.get(patchOsmId)
		if (!patchOsm) throw Error(`Osm for ${patchOsmId} not loaded.`)
		const baseOsm = this.osmixes.get(baseOsmId)
		if (!baseOsm) throw Error(`Osm for ${baseOsmId} not loaded.`)

		const changeset = new OsmixChangeset(baseOsm)
		this.changesets.set(baseOsmId, changeset)

		if (options.directMerge) {
			this.log(
				`Generating direct changes from ${patchOsmId} to ${baseOsmId}...`,
			)
			changeset.generateDirectChanges(patchOsm)
		}

		if (options.deduplicateWays) {
			let checkedWays = 0
			let dedpulicatedWays = 0
			this.log(`Deduplicating ways from ${patchOsmId}...`)
			for (const wayStats of changeset.deduplicateWaysGenerator(
				patchOsm.ways,
			)) {
				checkedWays++
				dedpulicatedWays += wayStats
				this.logEverySecond(
					`Deduplicating ways: ${checkedWays.toLocaleString()} ways checked, ${dedpulicatedWays.toLocaleString()} ways deduplicated`,
				)
			}
		}

		if (options.deduplicateNodes) {
			this.log(`Deduplicating nodes from ${patchOsmId}...`)
			changeset.deduplicateNodes(patchOsm.nodes)
			this.log(
				`Node deduplication results: ${changeset.deduplicatedNodes} de-duplicated nodes, ${changeset.deduplicatedNodesReplaced} nodes replaced`,
			)
		}

		if (options.createIntersections) {
			let checkedWays = 0
			this.log(`Creating intersections from ${patchOsmId}...`)

			// This will check if the osm dataset has the way before trying to create intersections for it.
			for (const _wayStats of changeset.createIntersectionsForWaysGenerator(
				patchOsm.ways,
			)) {
				checkedWays++
				this.logEverySecond(
					`Intersection creation progress: ${checkedWays.toLocaleString()} ways checked`,
				)
			}
		}

		this.sortChangeset(baseOsmId, changeset)
		return changeset.stats
	}

	sortChangeset(osmId: string, changeset: OsmixChangeset) {
		const filteredChanges: OsmixChange[] = []
		if (this.entityTypes.includes("node")) {
			for (const change of Object.values(changeset.nodeChanges)) {
				if (this.changeTypes.includes(change.changeType)) {
					filteredChanges.push(change)
				}
			}
		}
		if (this.entityTypes.includes("way")) {
			for (const change of Object.values(changeset.wayChanges)) {
				if (this.changeTypes.includes(change.changeType)) {
					filteredChanges.push(change)
				}
			}
		}
		if (this.entityTypes.includes("relation")) {
			for (const change of Object.values(changeset.relationChanges)) {
				if (this.changeTypes.includes(change.changeType)) {
					filteredChanges.push(change)
				}
			}
		}
		this.filteredChanges.set(osmId, filteredChanges)
	}

	sortChangesets() {
		for (const [osmId, changeset] of this.changesets) {
			this.sortChangeset(osmId, changeset)
		}
	}

	setChangesetFilters(
		changeTypes: OsmChangeTypes[],
		entityTypes: OsmEntityType[],
	) {
		if (
			dequal(this.changeTypes, changeTypes) &&
			dequal(this.entityTypes, entityTypes)
		) {
			return
		}
		this.changeTypes = changeTypes
		this.entityTypes = entityTypes
		this.sortChangesets()
	}

	getChangesetPage(osmId: string, page: number, pageSize: number) {
		const changeset = this.changesets.get(osmId)
		if (!changeset) throw Error("No active changeset")
		const filteredChanges = this.filteredChanges.get(osmId)
		const changes = filteredChanges?.slice(
			page * pageSize,
			(page + 1) * pageSize,
		)
		return {
			changes,
			totalPages: Math.ceil((filteredChanges?.length ?? 0) / pageSize),
		}
	}

	applyChangesAndReplace(osmId: string) {
		const changeset = this.changesets.get(osmId)
		if (!changeset) throw Error("No active changeset")
		const osm = changeset.applyChanges(osmId)
		this.changesets.delete(osmId)
		this.filteredChanges.delete(osmId)
		this.osmixes.set(osmId, osm)
		return osm.transferables()
	}
}

const isWorker = "importScripts" in globalThis
if (isWorker) {
	expose(new OsmixWorker())
}

export function createOsmWorker() {
	const worker = new Worker(new URL("./osm.worker.ts", import.meta.url), {
		type: "module",
	})
	return wrap<OsmixWorker>(worker)
}
