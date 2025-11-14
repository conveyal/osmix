import { SphericalMercator } from "@mapbox/sphericalmercator"
import {
	merge,
	type OsmChange,
	OsmChangeset,
	type OsmChangeTypes,
	type OsmMergeOptions,
} from "@osmix/change"
import {
	createOsmFromGeoJSON,
	createOsmFromPbf,
	type Osm,
	throttle,
} from "@osmix/core"
import {
	buildRelationRings,
	isMultipolygonRelation,
	wayIsArea,
} from "@osmix/json"
import { OsmixRasterTile } from "@osmix/raster"
import type {
	GeoBbox2D,
	LonLat,
	OsmEntityType,
	Tile,
} from "@osmix/shared/types"
import { OsmixVtEncoder } from "@osmix/vt"
import { expose, transfer, wrap } from "comlink"
import { dequal } from "dequal/lite"
import type { FeatureCollection, LineString, Point } from "geojson"
import { rasterTileToImageBuffer } from "../lib/raster-tile-to-image-buffer"
import { RASTER_TILE_SIZE } from "../settings"
import type { StatusType } from "../state/log"

const sphericalMercator = new SphericalMercator()

export class OsmixWorker {
	private osmixes = new Map<string, Osm>()
	private osmixVtEncoder = new Map<string, OsmixVtEncoder>()

	private changesets = new Map<string, OsmChangeset>()
	private changeTypes: OsmChangeTypes[] = ["create", "modify", "delete"]
	private entityTypes: OsmEntityType[] = ["node", "way", "relation"]
	private filteredChanges = new Map<string, OsmChange[]>()

	private log = (message: string, type?: StatusType) => {
		type === "error" ? console.error(message) : console.log(message)
	}
	private logEverySecond = throttle(this.log, 1_000)

	private getOrCreateVectorTileIndex(osmId: string) {
		const existing = this.osmixVtEncoder.get(osmId)
		if (existing) return existing
		const osm = this.osmixes.get(osmId)
		if (!osm) throw Error(`Osm for ${osmId} not loaded.`)
		const cache = new OsmixVtEncoder(osm)
		this.osmixVtEncoder.set(osmId, cache)
		return cache
	}

	private invalidateVectorTileIndex(osmId: string) {
		this.osmixVtEncoder.delete(osmId)
	}

	async fromPbf(id: string, data: ArrayBufferLike | ReadableStream) {
		const startTime = performance.now()
		const osm = await createOsmFromPbf(
			data instanceof ReadableStream ? data : new Uint8Array(data),
			{ id },
			(e) => this.log(e.detail.msg),
		)
		this.osmixes.set(id, osm)

		this.invalidateVectorTileIndex(id)
		this.getOrCreateVectorTileIndex(id)

		const endTime = performance.now()
		this.log(`${id} loaded in ${(endTime - startTime).toFixed(3)}ms`)
		return osm.transferables()
	}

	async fromGeoJSON(id: string, data: ArrayBufferLike | ReadableStream) {
		const startTime = performance.now()
		// Read the data as text
		let text: string
		if (data instanceof ReadableStream) {
			const reader = data.getReader()
			const decoder = new TextDecoder()
			let result = ""
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				result += decoder.decode(value, { stream: true })
			}
			// Flush any remaining bytes in the decoder's internal buffer
			result += decoder.decode()
			text = result
		} else {
			const decoder = new TextDecoder()
			text = decoder.decode(data)
		}

		// Parse JSON
		const geojson = JSON.parse(text) as FeatureCollection<Point | LineString>

		// Create Osmix from GeoJSON
		const osm = createOsmFromGeoJSON(geojson, { id }, (e) =>
			this.log(e.detail.msg),
		)
		this.osmixes.set(id, osm)

		this.invalidateVectorTileIndex(id)
		this.getOrCreateVectorTileIndex(id)

		const endTime = performance.now()
		this.log(`${id} loaded in ${(endTime - startTime).toFixed(3)}ms`)
		return osm.transferables()
	}

	setLogger(logger: typeof this.log) {
		this.log = logger
		this.logEverySecond = throttle(this.log, 1_000)
	}

	lonLatInBbox(lon: number, lat: number, bbox: GeoBbox2D) {
		return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
	}

	async getTileImage(id: string, tile: Tile, tileSize = RASTER_TILE_SIZE) {
		const osm = this.osmixes.get(id)
		if (!osm) throw Error(`Osm for ${id} not loaded.`)
		const bbox = sphericalMercator.bbox(tile[0], tile[1], tile[2]) as GeoBbox2D
		if (!bboxContainsOrIntersects(bbox, osm.bbox())) return new ArrayBuffer(0)

		const rasterTile = new OsmixRasterTile(tile, tileSize)

		// Get way IDs that are part of relations (to exclude from individual rendering)
		const relationWayIds = osm.relations.getWayMemberIds()

		// Draw relations (multipolygon relations)
		const relationTimer = `OsmixRasterTile.drawRelations:${tile[2]}/${tile[0]}/${tile[1]}`
		console.time(relationTimer)
		const relationIndexes = osm.relations.intersects(bbox)

		for (const relIndex of relationIndexes) {
			const relation = osm.relations.getByIndex(relIndex)
			if (!isMultipolygonRelation(relation)) continue

			const getWay = (wayId: number) => osm.ways.getById(wayId)
			const getNodeCoordinates = (nodeId: number): LonLat | undefined => {
				const ll = osm.nodes.getNodeLonLat({ id: nodeId })
				return ll ? [ll[0], ll[1]] : undefined
			}

			const rings = buildRelationRings(relation, getWay, getNodeCoordinates)
			if (rings.length > 0) {
				rasterTile.drawMultiPolygon(rings)
			}
		}
		console.timeEnd(relationTimer)

		// Draw ways (excluding those that are part of relations)
		const timer = `OsmixRasterTile.drawWays:${tile[2]}/${tile[0]}/${tile[1]}`
		console.time(timer)
		const wayIndexes = osm.ways.intersects(bbox, (wayIndex) => {
			if (relationWayIds.has(osm.ways.ids.at(wayIndex))) return false
			return true
		})
		const ways = wayIndexes.map((wayIndex) => ({
			coords: osm.ways.getCoordinates(wayIndex, osm.nodes),
			isArea: wayIsArea(osm.ways.getByIndex(wayIndex)),
		}))
		const { wayLines, wayPolygons } = ways.reduce(
			(acc, way) => {
				if (way.isArea) acc.wayPolygons.push(way)
				else acc.wayLines.push(way)
				return acc
			},
			{
				wayLines: [] as { coords: LonLat[]; isArea: boolean }[],
				wayPolygons: [] as { coords: LonLat[]; isArea: boolean }[],
			},
		)
		for (const way of wayPolygons) {
			rasterTile.drawPolygon([way.coords], [255, 0, 0, 64])
		}
		for (const way of wayLines) {
			rasterTile.drawLineString(way.coords)
		}
		console.timeEnd(timer)

		const data = await rasterTileToImageBuffer(rasterTile)
		return transfer(data, [data])
	}

	async getVectorTile(id: string, tile: Tile) {
		const osm = this.osmixes.get(id)
		if (!osm) throw Error(`Osm for ${id} not loaded.`)

		const bbox = sphericalMercator.bbox(tile[0], tile[1], tile[2])
		if (!bboxContainsOrIntersects(bbox, osm.bbox())) {
			console.log("OUT OF BOUNDS")
			return new ArrayBuffer(0)
		}

		const cache = this.getOrCreateVectorTileIndex(id)
		const data = cache.getTile(tile)
		if (!data || data.byteLength === 0) return new ArrayBuffer(0)

		return transfer(data, [data])
	}

	async merge(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmMergeOptions> = {},
	) {
		const baseOsm = this.osmixes.get(baseOsmId)
		if (!baseOsm) throw Error(`Osm for ${baseOsmId} not loaded.`)
		const patchOsm = this.osmixes.get(patchOsmId)
		if (!patchOsm) throw Error(`Osm for ${patchOsmId} not loaded.`)
		const mergedOsm = await merge(baseOsm, patchOsm, options)

		// Replace the base OSM with the merged OSM
		this.osmixes.set(baseOsmId, mergedOsm)
		this.invalidateVectorTileIndex(baseOsmId)

		// Delete the patch OSM
		this.osmixes.delete(patchOsmId)
		this.invalidateVectorTileIndex(patchOsmId)

		// Delete the changeset
		this.changesets.delete(baseOsmId)
		this.filteredChanges.delete(baseOsmId)

		return mergedOsm.transferables()
	}

	generateChangeset(
		baseOsmId: string,
		patchOsmId: string,
		options: Partial<OsmMergeOptions> = {},
	) {
		const patchOsm = this.osmixes.get(patchOsmId)
		if (!patchOsm) throw Error(`Osm for ${patchOsmId} not loaded.`)
		const baseOsm = this.osmixes.get(baseOsmId)
		if (!baseOsm) throw Error(`Osm for ${baseOsmId} not loaded.`)

		const changeset = new OsmChangeset(baseOsm)
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

/**
 * Check if the two bboxes intersect or are contained within each other.
 */
function bboxContainsOrIntersects(bb1: GeoBbox2D, bb2: GeoBbox2D) {
	const westIn =
		(bb1[0] >= bb2[0] && bb1[0] <= bb2[2]) ||
		(bb2[0] >= bb1[0] && bb2[0] <= bb1[2])
	const eastIn =
		(bb1[2] >= bb2[0] && bb1[2] <= bb2[2]) ||
		(bb2[2] >= bb1[0] && bb2[2] <= bb1[2])
	const northIn =
		(bb1[1] >= bb2[1] && bb1[1] <= bb2[3]) ||
		(bb2[1] >= bb1[1] && bb2[1] <= bb1[3])
	const southIn =
		(bb1[3] >= bb2[1] && bb1[3] <= bb2[3]) ||
		(bb2[3] >= bb1[1] && bb2[3] <= bb1[3])
	return (westIn || eastIn) && (northIn || southIn)
}
