import {
	merge,
	type OsmChange,
	OsmChangeset,
	type OsmChangeTypes,
	type OsmMergeOptions,
} from "@osmix/change"
import { Osm, type OsmOptions, type OsmTransferables } from "@osmix/core"
import { DEFAULT_RASTER_TILE_SIZE } from "@osmix/raster"
import type { Progress, ProgressEvent } from "@osmix/shared/progress"
import type { OsmEntityType, Tile } from "@osmix/shared/types"
import * as Comlink from "comlink"
import { dequal } from "dequal/lite"
import { Osmix } from "./osmix"
import type { OsmFromPbfOptions } from "./pbf"
import { collectTransferables } from "./utils"

/**
 * Worker handler for a single Osmix instance.
 */
export class OsmixWorker {
	private osmix = new Osmix()
	private changesets: Record<string, OsmChangeset> = {}
	private changeTypes: OsmChangeTypes[] = ["create", "modify", "delete"]
	private entityTypes: OsmEntityType[] = ["node", "way", "relation"]
	private filteredChanges: Record<string, OsmChange[]> = {}

	addProgressListener(listener: (progress: Progress) => void) {
		this.osmix.addEventListener("progress", (e: Event) =>
			listener((e as ProgressEvent).detail),
		)
	}

	readHeader(data: ArrayBufferLike | ReadableStream) {
		return this.osmix.readHeader(
			data instanceof ReadableStream ? data : new Uint8Array(data),
		)
	}

	async fromPbf({
		data,
		options,
	}: {
		data: ArrayBufferLike | ReadableStream
		options?: Partial<OsmFromPbfOptions>
	}) {
		const osm = await this.osmix.fromPbf(data, options)
		return osm.transferables()
	}

	async fromGeoJSON({
		data,
		options,
	}: {
		data: ArrayBufferLike | ReadableStream
		options?: Partial<OsmOptions>
	}) {
		const osm = await this.osmix.fromGeoJSON(data, options)
		return osm.transferables()
	}

	fromTransferables(transferables: OsmTransferables) {
		this.osmix.set(transferables.id, new Osm(transferables))
	}

	transfer(id: string) {
		const transferables = this.osmix.get(id).transferables()
		return Comlink.transfer(transferables, collectTransferables(transferables))
	}

	isReady(id: string): boolean {
		return this.osmix.isReady(id)
	}

	get(id: string) {
		return this.osmix.get(id).transferables()
	}

	set(id: string, transferables: OsmTransferables) {
		this.osmix.set(id, new Osm(transferables))
	}

	delete(id: string) {
		this.osmix.delete(id)
	}

	getVectorTile(id: string, tile: Tile) {
		const data = this.osmix.getVectorTile(id, tile)
		if (!data || data.byteLength === 0) return new ArrayBuffer(0)
		return Comlink.transfer(data, [data])
	}

	getRasterTile(id: string, tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		const data = this.osmix.getRasterTile(id, tile, tileSize)
		if (!data || data.byteLength === 0) return new ArrayBuffer(0)
		return Comlink.transfer(data, [data])
	}

	search(id: string, key: string, val?: string) {
		return this.osmix.search(id, key, val)
	}

	async merge(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmMergeOptions> = {},
	) {
		const baseOsm = this.osmix.get(baseOsmId)
		const patchOsm = this.osmix.get(patchOsmId)
		const mergedOsm = await merge(baseOsm, patchOsm, options)
		this.osmix.set(baseOsmId, mergedOsm)
		this.osmix.delete(patchOsmId)
		return mergedOsm.transferables()
	}

	async generateChangeset(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmMergeOptions> = {},
	) {
		const baseOsm = this.osmix.get(baseOsmId)
		const patchOsm = this.osmix.get(patchOsmId)
		const changeset = OsmChangeset.generateChangeset(
			baseOsm,
			patchOsm,
			options,
			(progress: ProgressEvent) => this.osmix.dispatchEvent(progress),
		)
		this.changesets[baseOsmId] = changeset
		this.sortChangeset(baseOsmId, changeset)
		return changeset.stats
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
		const newOsm = changeset.applyChanges(osmId)
		this.osmix.set(osmId, newOsm)
		delete this.changesets[osmId]
		delete this.filteredChanges[osmId]
		return newOsm.transferables()
	}

	private sortChangeset(osmId: string, changeset: OsmChangeset) {
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
		this.filteredChanges[osmId] = filteredChanges
	}

	private sortChangesets() {
		for (const [osmId, changeset] of Object.entries(this.changesets)) {
			this.sortChangeset(osmId, changeset)
		}
	}
}

Comlink.expose(new OsmixWorker())
