import type { OsmPbfWay } from "@osmix/pbf"
import type { GeoBbox2D, LonLat, OsmTags, OsmWay } from "@osmix/shared/types"
import Flatbush from "flatbush"
import { around as geoAround } from "geoflatbush"
import { Entities, type EntitiesTransferables } from "./entities"
import { type IdOrIndex, Ids } from "./ids"
import type { Nodes } from "./nodes"
import type StringTable from "./stringtable"
import { Tags } from "./tags"
import {
	BufferConstructor,
	type BufferType,
	IdArrayType,
	ResizeableTypedArray as RTA,
} from "./typed-arrays"
import type { ContentHasher } from "./utils"

export interface WaysTransferables<T extends BufferType = BufferType>
	extends EntitiesTransferables<T> {
	refStart: T
	refCount: T
	refs: T
	bbox: T
	/** Optional - can be rebuilt via buildSpatialIndex() */
	spatialIndex?: T
}

export class Ways extends Entities<OsmWay> {
	private spatialIndex: Flatbush = new Flatbush(1)
	// Track if spatial index was properly built (vs default empty)
	private spatialIndexBuilt = false

	private refStart: RTA<Uint32Array>
	private refCount: RTA<Uint16Array> // Maximum 2,000 nodes per way

	// Node IDs
	private refs: RTA<Float64Array>

	// Bounding box of the way in geographic coordinates
	private bbox: RTA<Float64Array>

	// Node reference index
	private nodes: Nodes

	/**
	 * Create a new Ways index.
	 */
	constructor(
		stringTable: StringTable,
		nodes: Nodes,
		transferables?: WaysTransferables,
	) {
		if (transferables) {
			super("way", new Ids(transferables), new Tags(stringTable, transferables))
			this.refStart = RTA.from(Uint32Array, transferables.refStart)
			this.refCount = RTA.from(Uint16Array, transferables.refCount)
			this.refs = RTA.from(IdArrayType, transferables.refs)
			this.bbox = RTA.from(Float64Array, transferables.bbox)
			// Only load spatial index if provided (not stored in IndexedDB)
			if (transferables.spatialIndex?.byteLength) {
				this.spatialIndex = Flatbush.from(transferables.spatialIndex)
				this.spatialIndexBuilt = true
			}
			this.indexBuilt = true
		} else {
			super("way", new Ids(), new Tags(stringTable))
			this.refStart = new RTA(Uint32Array)
			this.refCount = new RTA(Uint16Array)
			this.refs = new RTA(IdArrayType)
			this.bbox = new RTA(Float64Array)
		}
		this.nodes = nodes
	}

	/**
	 * Add a single way to the index.
	 */
	addWay(way: OsmWay) {
		const wayIndex = this.addEntity(way.id, way.tags ?? {})
		this.refStart.push(this.refs.length)
		this.refCount.push(way.refs.length)
		for (const ref of way.refs) this.refs.push(ref)
		return wayIndex
	}

	/**
	 * Bulk add ways directly from a PBF PrimitiveBlock.
	 */
	addWays(
		ways: OsmPbfWay[],
		blockStringIndexMap: Uint32Array,
		filter?: (way: OsmWay) => OsmWay | null,
	) {
		let added = 0
		for (const way of ways) {
			let prevRefId = 0
			const refs = way.refs.map((refId) => {
				prevRefId += refId
				return prevRefId
			})
			const filteredWay = filter
				? filter({
						id: way.id,
						refs,
						tags: this.tags.getTagsFromIndices(way.keys, way.vals),
					})
				: null
			if (filter && filteredWay === null) continue

			const tagKeys: number[] = way.keys.map((key) => {
				const index = blockStringIndexMap[key]
				if (index === undefined) throw Error("Tag key not found")
				return index
			})
			const tagValues: number[] = way.vals.map((val) => {
				const index = blockStringIndexMap[val]
				if (index === undefined) throw Error("Tag value not found")
				return index
			})

			this.addEntity(way.id, tagKeys, tagValues)
			this.refStart.push(this.refs.length)
			this.refCount.push(filteredWay?.refs.length ?? refs.length)
			this.refs.pushMany(filteredWay?.refs ?? refs)
			added++
		}
		return added
	}

	/**
	 * Compact the internal arrays to free up memory.
	 */
	buildEntityIndex() {
		this.refStart.compact()
		this.refCount.compact()
		this.refs.compact()
	}

	/**
	 * Build the spatial index for ways.
	 * If bbox data already exists (e.g., loaded from storage), reuses it.
	 */
	buildSpatialIndex() {
		if (!this.nodes.isReady()) throw Error("Node index is not ready.")
		if (this.size === 0) return this.spatialIndex

		this.spatialIndex = new Flatbush(
			this.size,
			128,
			Float64Array,
			BufferConstructor,
		)

		// If bbox already has data (loaded from storage), use it directly
		const hasBboxData = this.bbox.length >= this.size * 4
		for (let i = 0; i < this.size; i++) {
			let minX: number
			let minY: number
			let maxX: number
			let maxY: number

			if (hasBboxData) {
				// Use stored bbox values
				minX = this.bbox.at(i * 4)
				minY = this.bbox.at(i * 4 + 1)
				maxX = this.bbox.at(i * 4 + 2)
				maxY = this.bbox.at(i * 4 + 3)
			} else {
				// Calculate bbox from node coordinates
				minX = Number.POSITIVE_INFINITY
				minY = Number.POSITIVE_INFINITY
				maxX = Number.NEGATIVE_INFINITY
				maxY = Number.NEGATIVE_INFINITY
				const start = this.refStart.at(i)
				const count = this.refCount.at(i)
				for (let j = start; j < start + count; j++) {
					const refId = this.refs.at(j)
					const [lon, lat] = this.nodes.getNodeLonLat({ id: refId })
					if (lon < minX) minX = lon
					if (lon > maxX) maxX = lon
					if (lat < minY) minY = lat
					if (lat > maxY) maxY = lat
				}
				this.bbox.push(minX)
				this.bbox.push(minY)
				this.bbox.push(maxX)
				this.bbox.push(maxY)
			}
			this.spatialIndex.add(minX, minY, maxX, maxY)
		}
		// Compact bbox if we just calculated it
		if (!hasBboxData) {
			this.bbox.compact()
		}
		this.spatialIndex.finish()
		this.spatialIndexBuilt = true
		return this.spatialIndex
	}

	/**
	 * Check if the spatial index has been built.
	 */
	hasSpatialIndex(): boolean {
		return this.spatialIndexBuilt
	}

	/**
	 * Get the full way entity.
	 */
	getFullEntity(index: number, id: number, tags?: OsmTags): OsmWay {
		return {
			id,
			refs: [...this.getRefIds(index)],
			tags,
		}
	}

	/**
	 * Get the node IDs referenced by a way.
	 */
	getRefIds(index: number): number[] {
		const start = this.refStart.at(index)
		const count = this.refCount.at(index)
		return Array.from(this.refs.slice(start, start + count))
	}

	/**
	 * Get the bounding box of a way.
	 */
	getEntityBbox(idOrIndex: IdOrIndex): GeoBbox2D {
		const index =
			"index" in idOrIndex ? idOrIndex.index : this.ids.idOrIndex(idOrIndex)[0]
		return [
			this.bbox.at(index * 4),
			this.bbox.at(index * 4 + 1),
			this.bbox.at(index * 4 + 2),
			this.bbox.at(index * 4 + 3),
		]
	}

	/**
	 * Get the coordinates of a way as a flat array.
	 */
	getLine(index: number) {
		const count = this.refCount.at(index)
		const start = this.refStart.at(index)
		const line = new Float64Array(count * 2)
		for (let i = 0; i < count; i++) {
			const ref = this.refs.at(start + i)
			const [lon, lat] = this.nodes.getNodeLonLat({ id: ref })
			line[i * 2] = lon
			line[i * 2 + 1] = lat
		}
		return line
	}

	/**
	 * Get the coordinates of a way as an array of [lon, lat] pairs.
	 */
	getCoordinates(index: number): LonLat[] {
		const count = this.refCount.at(index)
		const start = this.refStart.at(index)
		const coords: [number, number][] = []
		for (let refIndex = start; refIndex < start + count; refIndex++) {
			const ref = this.refs.at(refIndex)
			const coord = this.nodes.getNodeLonLat({ id: ref })
			if (
				coord === undefined ||
				coord[0] === undefined ||
				coord[1] === undefined
			) {
				throw Error(
					`Invalid coordinate for way id ${this.ids.at(index)}, index ${index}, node ref ${ref}, ref index ${refIndex}`,
				)
			}
			coords.push(coord)
		}
		return coords
	}

	/**
	 * Find way indexes that intersect a bounding box.
	 */
	intersects(bbox: GeoBbox2D, filterFn?: (index: number) => boolean): number[] {
		if (this.size === 0) return []
		return this.spatialIndex.search(
			bbox[0],
			bbox[1],
			bbox[2],
			bbox[3],
			filterFn,
		)
	}

	/**
	 * Find way indexes near a point using great-circle distance.
	 * @param lon - Longitude in degrees.
	 * @param lat - Latitude in degrees.
	 * @param maxResults - Maximum number of results to return.
	 * @param maxDistanceKm - Maximum distance in kilometers.
	 * @returns Array of way indexes sorted by distance.
	 */
	neighbors(
		lon: number,
		lat: number,
		maxResults?: number,
		maxDistanceKm?: number,
	): number[] {
		if (this.size === 0) return []
		// Use geoflatbush for proper geographic distance calculations
		return geoAround(this.spatialIndex, lon, lat, maxResults, maxDistanceKm)
	}

	/**
	 * Get ways within a bounding box.
	 */
	withinBbox(
		bbox: GeoBbox2D,
		include?: (index: number) => boolean,
	): {
		ids: Float64Array
		positions: Float64Array
		startIndices: Uint32Array
	} {
		const wayCandidates = this.intersects(bbox, include)
		const ids = new Float64Array(wayCandidates.length)
		const wayPositions: Float64Array[] = []
		const wayStartIndices = new Uint32Array(wayCandidates.length + 1)
		wayStartIndices[0] = 0

		let size = 0
		wayCandidates.forEach((wayIndex, i) => {
			ids[i] = this.ids.at(wayIndex)
			const way = this.getLine(wayIndex)
			size += way.length
			wayPositions.push(way)
			const prevIndex = wayStartIndices[i]
			if (prevIndex === undefined) throw Error("Previous index is undefined")
			wayStartIndices[i + 1] = prevIndex + way.length / 2
		})
		const wayPositionsArray = new Float64Array(size)
		let pIndex = 0
		for (const way of wayPositions) {
			wayPositionsArray.set(way, pIndex)
			pIndex += way.length
		}

		return {
			ids,
			positions: wayPositionsArray,
			startIndices: wayStartIndices,
		}
	}

	/**
	 * Get transferable objects for passing to another thread.
	 * Only includes spatialIndex if it has been built.
	 */
	override transferables(): WaysTransferables {
		const base = {
			...super.transferables(),
			refStart: this.refStart.array.buffer,
			refCount: this.refCount.array.buffer,
			refs: this.refs.array.buffer,
			bbox: this.bbox.array.buffer,
		}
		// Only include spatial index if it was built
		if (this.spatialIndexBuilt) {
			return { ...base, spatialIndex: this.spatialIndex.data }
		}
		return base
	}

	/**
	 * Get the approximate memory requirements for a given number of ways in bytes.
	 */
	static getBytesRequired(count: number) {
		if (count === 0) return 0
		// Approximate nodes per way
		let numNodes = count
		let n = count
		while (n !== 1) {
			n = Math.ceil(n / 128)
			numNodes += n
		}
		const indexBytes = (numNodes < 16384 ? 2 : 4) * numNodes
		const boxesBytes = numNodes * 4 * Float64Array.BYTES_PER_ELEMENT
		const spatialIndexBytes = 8 + indexBytes + boxesBytes

		return (
			Ids.getBytesRequired(count) +
			Tags.getBytesRequired(count) +
			count * Uint32Array.BYTES_PER_ELEMENT + // refStart
			count * Uint16Array.BYTES_PER_ELEMENT + // refCount
			count * 4 * Float64Array.BYTES_PER_ELEMENT + // bbox
			spatialIndexBytes
		)
	}

	/**
	 * Update a ContentHasher with way-specific data (node references).
	 */
	override updateHash(hasher: ContentHasher): ContentHasher {
		return super
			.updateHash(hasher)
			.update(this.refStart.array)
			.update(this.refCount.array)
			.update(this.refs.array)
	}
}
