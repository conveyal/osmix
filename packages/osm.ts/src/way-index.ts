import { cleanCoords, nearestPointOnLine } from "@turf/turf"
import Flatbush from "flatbush"
import { EntityIndex, type EntityIndexTransferables } from "./entity-index"
import { IdIndex, type IdOrIndex } from "./id-index"
import type { NodeIndex } from "./node-index"
import type { OsmPbfWay } from "./pbf"
import type StringTable from "./stringtable"
import { TagIndex } from "./tag-index"
import {
	BufferConstructor,
	CoordinateArrayType,
	IdArrayType,
	ResizeableTypedArray,
	type TypedArrayBuffer,
} from "./typed-arrays"
import type { GeoBbox2D, LonLat, OsmTags, OsmWay } from "./types"

export interface WayIndexTransferables extends EntityIndexTransferables {
	refStart: TypedArrayBuffer
	refCount: TypedArrayBuffer
	refs: TypedArrayBuffer
	bbox: TypedArrayBuffer
	spatialIndex: TypedArrayBuffer
}

export class WayIndex extends EntityIndex<OsmWay> {
	spatialIndex: Flatbush = new Flatbush(1)

	refStart = new ResizeableTypedArray(Uint32Array)
	refCount = new ResizeableTypedArray(Uint16Array) // Maximum 2,000 nodes per way

	// Node IDs
	refs = new ResizeableTypedArray(IdArrayType)

	// Bounding box of the way in geographic coordinates
	bbox = new ResizeableTypedArray(CoordinateArrayType)

	static from(stringTable: StringTable, wits: WayIndexTransferables) {
		const idIndex = IdIndex.from(wits)
		const tagIndex = TagIndex.from(stringTable, wits)
		const wayIndex = new WayIndex(stringTable, idIndex, tagIndex)
		wayIndex.refStart = ResizeableTypedArray.from(Uint32Array, wits.refStart)
		wayIndex.refCount = ResizeableTypedArray.from(Uint16Array, wits.refCount)
		wayIndex.refs = ResizeableTypedArray.from(IdArrayType, wits.refs)
		wayIndex.bbox = ResizeableTypedArray.from(CoordinateArrayType, wits.bbox)
		wayIndex.spatialIndex = Flatbush.from(wits.spatialIndex)
		return wayIndex
	}

	constructor(
		stringTable: StringTable,
		idIndex?: IdIndex,
		tagIndex?: TagIndex,
	) {
		super("way", stringTable, idIndex, tagIndex)
	}

	transferables(): WayIndexTransferables {
		return {
			refStart: this.refStart.array.buffer,
			refCount: this.refCount.array.buffer,
			refs: this.refs.array.buffer,
			bbox: this.bbox.array.buffer,
			spatialIndex: this.spatialIndex.data,
			...this.ids.transferables(),
			...this.tags.transferables(),
		}
	}

	addWay(way: OsmWay) {
		this.ids.add(way.id)
		this.tags.addTags(way.tags)
		this.refStart.push(this.refs.length)
		this.refCount.push(way.refs.length)
		for (const ref of way.refs) this.refs.push(ref)
	}

	/**
	 * Bulk add ways directly from a PBF PrimitiveBlock.
	 */
	addWays(ways: OsmPbfWay[], blockStringIndexMap: Map<number, number>) {
		for (const way of ways) {
			this.ids.add(way.id)

			let refId = 0
			this.refStart.push(this.refs.length)
			this.refCount.push(way.refs.length)

			for (const refSid of way.refs) {
				refId += refSid
				this.refs.push(refId)
			}

			const tagKeys: number[] = way.keys.map((key) => {
				const index = blockStringIndexMap.get(key)
				if (index === undefined) throw Error("Tag key not found")
				return index
			})
			const tagValues: number[] = way.vals.map((val) => {
				const index = blockStringIndexMap.get(val)
				if (index === undefined) throw Error("Tag value not found")
				return index
			})
			this.tags.addTagKeysAndValues(tagKeys, tagValues)
		}
	}

	finishEntityIndex() {
		this.refStart.compact()
		this.refCount.compact()
		this.refs.compact()
	}

	buildSpatialIndex(nodeIndex: NodeIndex) {
		console.time("WayIndex.buildSpatialIndex")
		this.spatialIndex = new Flatbush(
			this.size,
			128,
			Float64Array,
			BufferConstructor,
		)
		for (let i = 0; i < this.size; i++) {
			let minX = Number.POSITIVE_INFINITY
			let minY = Number.POSITIVE_INFINITY
			let maxX = Number.NEGATIVE_INFINITY
			let maxY = Number.NEGATIVE_INFINITY
			const start = this.refStart.at(i)
			const count = this.refCount.at(i)
			for (let j = start; j < start + count; j++) {
				const refId = this.refs.at(j)
				const [lon, lat] = nodeIndex.getNodeLonLat({ id: refId })
				if (lon < minX) minX = lon
				if (lon > maxX) maxX = lon
				if (lat < minY) minY = lat
				if (lat > maxY) maxY = lat
			}
			this.bbox.push(minX)
			this.bbox.push(minY)
			this.bbox.push(maxX)
			this.bbox.push(maxY)
			this.spatialIndex.add(minX, minY, maxX, maxY)
		}
		this.spatialIndex.finish()
		console.timeEnd("WayIndex.buildSpatialIndex")
		return this.spatialIndex
	}

	getFullEntity(index: number, id: number, tags?: OsmTags): OsmWay {
		return {
			id,
			refs: this.getRefIds(index),
			tags,
		}
	}

	getRefIds(index: number): number[] {
		const start = this.refStart.at(index)
		const count = this.refCount.at(index)
		const refs: number[] = []
		for (let i = start; i < start + count; i++) {
			refs.push(this.refs.at(i))
		}
		return refs
	}

	getBbox(idOrIndex: IdOrIndex): GeoBbox2D {
		const [index] = this.ids.idOrIndex(idOrIndex)
		return [
			this.bbox.at(index * 4),
			this.bbox.at(index * 4 + 1),
			this.bbox.at(index * 4 + 2),
			this.bbox.at(index * 4 + 3),
		]
	}

	getLine(index: number, nodeIndex: NodeIndex) {
		const count = this.refCount.at(index)
		const start = this.refStart.at(index)
		const line = new Float64Array(count * 2)
		for (let i = 0; i < count; i++) {
			const ref = this.refs.at(start + i)
			const [lon, lat] = nodeIndex.getNodeLonLat({ id: ref })
			line[i * 2] = lon
			line[i * 2 + 1] = lat
		}
		return line
	}

	getCoordinates(index: number, nodeIndex: NodeIndex): [number, number][] {
		const line = this.getLine(index, nodeIndex)
		const coords: [number, number][] = []
		for (let i = 0; i < line.length; i += 2) {
			const lon = line[i]
			const lat = line[i + 1]
			if (lon === undefined || lat === undefined)
				throw Error("Invalid coordinate")
			coords.push([lon, lat])
		}
		return coords
	}

	getLineString(
		i: IdOrIndex,
		nodeIndex: NodeIndex,
	): GeoJSON.Feature<GeoJSON.LineString, OsmTags> {
		const [index, id] = this.ids.idOrIndex(i)
		const coordinates = this.getCoordinates(index, nodeIndex)
		return {
			type: "Feature",
			geometry: {
				type: "LineString",
				coordinates,
			},
			id,
			properties: this.tags.getTags(index) ?? {},
		}
	}

	intersects(bbox: GeoBbox2D): number[] {
		return this.spatialIndex.search(bbox[0], bbox[1], bbox[2], bbox[3])
	}

	neighbors(
		x: number,
		y: number,
		maxResults?: number,
		maxDistance?: number,
	): number[] {
		return this.spatialIndex.neighbors(x, y, maxResults, maxDistance)
	}

	nearestPointOnLine(index: number, ll: LonLat, nodeIndex: NodeIndex) {
		const lineString = this.getLineString({ index }, nodeIndex)
		const nearestPoint = nearestPointOnLine(cleanCoords(lineString), [
			ll.lon,
			ll.lat,
		])
		return nearestPoint
	}
}
