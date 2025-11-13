import {
	merge,
	type OsmChangeTypes,
	type OsmixChange,
	OsmixChangeset,
	type OsmixMergeOptions,
} from "@osmix/change"
import { Osmix, type OsmixTransferables, throttle } from "@osmix/core"
import type { OsmEntityType } from "@osmix/json"
import * as Comlink from "comlink"
import { dequal } from "dequal/lite"

export class OsmixMergeWorker {
	private osmixes: Record<string, Osmix> = {}
	private changesets: Record<string, OsmixChangeset> = {}
	private changeTypes: OsmChangeTypes[] = ["create", "modify", "delete"]
	private entityTypes: OsmEntityType[] = ["node", "way", "relation"]
	private filteredChanges: Record<string, OsmixChange[]> = {}
	private log: (message: string) => void = console.log

	async fromTransferables(transferables: OsmixTransferables) {
		const osmix = new Osmix(transferables)
		this.set(transferables.id, osmix)
	}

	set(id: string, osmix: Osmix) {
		this.osmixes[id] = osmix
	}

	setLogger(logger: (message: string) => void) {
		this.log = logger
	}

	async merge(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmixMergeOptions> = {},
	) {
		const baseOsm = this.osmixes[baseOsmId]
		const patchOsm = this.osmixes[patchOsmId]
		if (!baseOsm || !patchOsm) throw new Error("Osm not found")
		const mergedOsm = await merge(baseOsm, patchOsm, options)

		this.osmixes[baseOsmId] = mergedOsm
		delete this.osmixes[patchOsmId]

		return mergedOsm.transferables()
	}

	generateChangeset(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmixMergeOptions> = {},
	) {
		const patchOsm = this.osmixes[patchOsmId]
		if (!patchOsm) throw Error(`Osm for ${patchOsmId} not loaded.`)
		const baseOsm = this.osmixes[baseOsmId]
		if (!baseOsm) throw Error(`Osm for ${baseOsmId} not loaded.`)

		const changeset = new OsmixChangeset(baseOsm)
		this.changesets[baseOsmId] = changeset

		if (options.directMerge) {
			this.log(
				`Generating direct changes from ${patchOsmId} to ${baseOsmId}...`,
			)
			changeset.generateDirectChanges(patchOsm)
		}

		const logEverySecond = throttle(this.log, 1_000)

		if (options.deduplicateWays) {
			let checkedWays = 0
			let dedpulicatedWays = 0
			this.log(`Deduplicating ways from ${patchOsmId}...`)
			for (const wayStats of changeset.deduplicateWaysGenerator(
				patchOsm.ways,
			)) {
				checkedWays++
				dedpulicatedWays += wayStats
				logEverySecond(
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
				logEverySecond(
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
		this.filteredChanges[osmId] = filteredChanges
	}

	sortChangesets() {
		for (const [osmId, changeset] of Object.entries(this.changesets)) {
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
		const changeset = this.changesets[osmId]
		if (!changeset) throw Error("No active changeset")
		const filteredChanges = this.filteredChanges[osmId]
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
		const changeset = this.changesets[osmId]
		if (!changeset) throw Error("No active changeset")
		const osm = changeset.applyChanges(osmId)
		delete this.changesets[osmId]
		delete this.filteredChanges[osmId]
		this.osmixes[osmId] = osm
		return osm.transferables()
	}
}

const isWorker = "importScripts" in globalThis
if (isWorker) {
	Comlink.expose(new OsmixMergeWorker())
}
