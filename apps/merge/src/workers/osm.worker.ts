import {
	type GeoBbox2D,
	type OsmChange,
	type OsmChangeset,
	type OsmChangeTypes,
	Osmix,
	type OsmMergeOptions,
	type TileIndex,
	throttle,
} from "@osmix/core"
import type { OsmEntityType } from "@osmix/json"
import { expose, transfer } from "comlink"
import { dequal } from "dequal/lite"
import {
	MIN_NODE_ZOOM,
	RASTER_TILE_IMAGE_TYPE,
	RASTER_TILE_SIZE,
} from "@/settings"
import type { StatusType } from "@/state/log"

export class OsmixWorker {
	private osmixes = new Map<string, Osmix>()

	private changesets = new Map<string, OsmChangeset>()
	private changeTypes: OsmChangeTypes[] = ["create", "modify", "delete"]
	private entityTypes: OsmEntityType[] = ["node", "way", "relation"]
	private filteredChanges = new Map<string, OsmChange[]>()

	private log = (message: string, type?: StatusType) => {
		type === "error" ? console.error(message) : console.log(message)
	}

	async fromPbf(id: string, data: ArrayBufferLike | ReadableStream) {
		const osm = await Osmix.fromPbf(data, id, this.log)
		this.osmixes.set(id, osm)
		return osm.transferables()
	}

	setLogger(logger: typeof this.log) {
		this.log = logger
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

		const rasterTile = osm.createRasterTile(bbox, tileIndex, tileSize)
		rasterTile.drawWays()
		if (tileIndex.z >= MIN_NODE_ZOOM) {
			rasterTile.drawNodes()
		}
		const canvas = new OffscreenCanvas(rasterTile.tileSize, rasterTile.tileSize)
		const ctx = canvas.getContext("2d")
		if (!ctx) throw Error("Failed to get context")
		ctx.putImageData(
			new ImageData(
				rasterTile.imageData,
				rasterTile.tileSize,
				rasterTile.tileSize,
			),
			0,
			0,
		)
		const blob = await canvas.convertToBlob({ type: RASTER_TILE_IMAGE_TYPE })
		const data = await blob.arrayBuffer()

		return transfer({ data, contentType: RASTER_TILE_IMAGE_TYPE }, [data])
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

	dedupeNodesAndWays(id: string) {
		const osm = this.osmixes.get(id)
		if (!osm) throw Error(`Osm for ${id} not loaded.`)
		const changeset = osm.createChangeset()
		this.changesets.set(id, changeset)
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
		this.sortChangeset(id, changeset)

		return changeset.stats
	}

	generateChangeset(
		baseOsmId: string,
		patchOsmId: string,
		options: OsmMergeOptions,
	) {
		const patchOsm = this.osmixes.get(patchOsmId)
		if (!patchOsm) throw Error(`Osm for ${patchOsmId} not loaded.`)
		const baseOsm = this.osmixes.get(baseOsmId)
		if (!baseOsm) throw Error(`Osm for ${baseOsmId} not loaded.`)
		const changeset = baseOsm.createChangeset()

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

		this.changesets.set(baseOsmId, changeset)
		this.sortChangeset(baseOsmId, changeset)

		return changeset.stats
	}

	sortChangeset(osmId: string, changeset: OsmChangeset) {
		const filteredChanges: OsmChange[] = []
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
			totalPages: Math.ceil(filteredChanges?.length ?? 0 / pageSize),
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

expose(new OsmixWorker())
