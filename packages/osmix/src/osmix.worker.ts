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
import { OsmixVtEncoder } from "@osmix/vt"
import * as Comlink from "comlink"
import { dequal } from "dequal/lite"
import { Osmix } from "./osmix"
import type { OsmFromPbfOptions } from "./pbf"
import { transfer } from "./utils"

/**
 * Worker handler for a single Osmix instance.
 */
export class OsmixWorker extends EventTarget {
	private osmix = new Osmix()
	private osm: Record<string, Osm> = {}
	private vtEncoders: Record<string, OsmixVtEncoder> = {}
	private changesets: Record<string, OsmChangeset> = {}
	private changeTypes: OsmChangeTypes[] = ["create", "modify", "delete"]
	private entityTypes: OsmEntityType[] = ["node", "way", "relation"]
	private filteredChanges: Record<string, OsmChange[]> = {}

	addProgressListener(listener: (progress: Progress) => void) {
		this.osmix.addEventListener("progress", (e: Event) =>
			listener((e as ProgressEvent).detail),
		)
		this.addEventListener("progress", (e: Event) =>
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
		this.set(osm.id, osm)
		return osm.info()
	}

	toPbfStream({
		osmId,
		writeableStream,
	}: {
		osmId: string
		writeableStream: WritableStream<Uint8Array>
	}) {
		return this.osmix.toPbfStream(this.get(osmId)).pipeTo(writeableStream)
	}

	async toPbf(osmId: string) {
		const data = await this.osmix.toPbf(this.get(osmId))
		return Comlink.transfer(data, [data.buffer])
	}

	async fromGeoJSON({
		data,
		options,
	}: {
		data: ArrayBufferLike | ReadableStream
		options?: Partial<OsmOptions>
	}) {
		const osm = await this.osmix.fromGeoJSON(data, options)
		this.set(osm.id, osm)
		return osm.info()
	}

	transferIn(transferables: OsmTransferables) {
		this.set(transferables.id, new Osm(transferables))
	}

	transferOut(id: string) {
		const transferables = this.get(id).transferables()
		this.delete(id)
		return transfer(transferables)
	}

	getOsmBuffers(id: string) {
		return this.get(id).transferables()
	}

	has(id: string): boolean {
		return this.osm[id] != null
	}

	isReady(id: string): boolean {
		return this.osm[id]?.isReady() ?? false
	}

	private get(id: string) {
		if (!this.osm[id]) throw Error(`OSM not found for id: ${id}`)
		return this.osm[id]
	}

	private set(id: string, osm: Osm) {
		this.osm[id] = osm
		this.vtEncoders[id] = new OsmixVtEncoder(osm)
	}

	delete(id: string) {
		delete this.osm[id]
		delete this.vtEncoders[id]
	}

	getVtEncoder(id: string) {
		if (this.vtEncoders[id]) return this.vtEncoders[id]
		this.vtEncoders[id] = new OsmixVtEncoder(this.get(id))
		return this.vtEncoders[id]
	}

	getVectorTile(id: string, tile: Tile) {
		const data = this.getVtEncoder(id).getTile(tile)
		if (!data || data.byteLength === 0) return new ArrayBuffer(0)
		return Comlink.transfer(data, [data])
	}

	getRasterTile(id: string, tile: Tile, tileSize = DEFAULT_RASTER_TILE_SIZE) {
		const data = this.osmix.getRasterTile(this.get(id), tile, tileSize)
		if (!data || data.byteLength === 0) return new Uint8ClampedArray(0)
		return Comlink.transfer(data, [data.buffer])
	}

	search(id: string, key: string, val?: string) {
		return this.osmix.search(this.get(id), key, val)
	}

	async merge(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmMergeOptions> = {},
	) {
		const baseOsm = this.get(baseOsmId)
		const patchOsm = this.get(patchOsmId)
		const mergedOsm = await merge(baseOsm, patchOsm, options)
		this.set(baseOsmId, mergedOsm)
		this.delete(patchOsmId)
		return mergedOsm.id
	}

	async generateChangeset(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmMergeOptions> = {},
	) {
		const baseOsm = this.get(baseOsmId)
		const patchOsm = this.get(patchOsmId)
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
		this.set(osmId, newOsm)
		delete this.changesets[osmId]
		delete this.filteredChanges[osmId]
		return newOsm.id
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
