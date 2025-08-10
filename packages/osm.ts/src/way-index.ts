import { EntityIndex, type EntityIndexTransferables } from "./entity-index"
import type { GeoBbox2D, OsmTags, OsmWay } from "./types"
import {
	BufferConstructor,
	CoordinateArrayType,
	IdArrayType,
	ResizeableTypedArray,
	type TypedArrayBuffer,
} from "./typed-arrays"
import type { NodeIndex } from "./node-index"
import type StringTable from "./stringtable"
import Flatbush from "flatbush"
import type {
	OsmPbfPrimitiveBlock,
	OsmPbfWay,
	PrimitiveBlockParser,
} from "./pbf"
import { IdIndex, type IdOrIndex } from "./id-index"
import { TagIndex } from "./tag-index"

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

	// WayIndex is dependent on a NodeIndex
	nodeIndex: NodeIndex

	static from(
		stringTable: StringTable,
		nodeIndex: NodeIndex,
		wits: WayIndexTransferables,
	) {
		const idIndex = IdIndex.from(wits)
		const tagIndex = TagIndex.from(stringTable, wits)
		const wayIndex = new WayIndex(stringTable, nodeIndex, idIndex, tagIndex)
		wayIndex.refStart = ResizeableTypedArray.from(Uint32Array, wits.refStart)
		wayIndex.refCount = ResizeableTypedArray.from(Uint16Array, wits.refCount)
		wayIndex.refs = ResizeableTypedArray.from(IdArrayType, wits.refs)
		wayIndex.bbox = ResizeableTypedArray.from(CoordinateArrayType, wits.bbox)
		wayIndex.spatialIndex = Flatbush.from(wits.spatialIndex)
		return wayIndex
	}

	constructor(
		stringTable: StringTable,
		nodeIndex: NodeIndex,
		idIndex?: IdIndex,
		tagIndex?: TagIndex,
	) {
		super("way", stringTable, idIndex, tagIndex)
		this.nodeIndex = nodeIndex
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
		const bbox: GeoBbox2D = [
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]
		for (const ref of way.refs) {
			this.refs.push(ref)
			const [lon, lat] = this.nodeIndex.getNodeLonLat({ id: ref })
			if (lon < bbox[0]) bbox[0] = lon
			if (lon > bbox[2]) bbox[2] = lon
			if (lat < bbox[1]) bbox[1] = lat
			if (lat > bbox[3]) bbox[3] = lat
		}
		this.bbox.push(bbox[0])
		this.bbox.push(bbox[1])
		this.bbox.push(bbox[2])
		this.bbox.push(bbox[3])
	}

	/**
	 * Bulk add ways directly from a PBF PrimitiveBlock.
	 */
	addWays(ways: OsmPbfWay[], blockStringIndexMap: Map<number, number>) {
		for (const way of ways) {
			this.ids.add(way.id)

			let refId = 0
			const bbox: GeoBbox2D = [
				Number.POSITIVE_INFINITY,
				Number.POSITIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
			]
			this.refStart.push(this.refs.length)
			this.refCount.push(way.refs.length)

			for (const refSid of way.refs) {
				refId += refSid
				this.refs.push(refId)
				const [lon, lat] = this.nodeIndex.getNodeLonLat({ id: refId })
				if (lon < bbox[0]) bbox[0] = lon
				if (lon > bbox[2]) bbox[2] = lon
				if (lat < bbox[1]) bbox[1] = lat
				if (lat > bbox[3]) bbox[3] = lat
			}

			this.bbox.push(bbox[0])
			this.bbox.push(bbox[1])
			this.bbox.push(bbox[2])
			this.bbox.push(bbox[3])

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
		this.bbox.compact()
		this.buildSpatialIndex()
	}

	buildSpatialIndex() {
		console.time("WayIndex.buildSpatialIndex")
		this.spatialIndex = new Flatbush(
			this.size,
			128,
			Float64Array,
			BufferConstructor,
		)
		for (let i = 0; i < this.size; i++) {
			const [minX, minY, maxX, maxY] = this.getBbox(i)
			this.spatialIndex.add(minX, minY, maxX, maxY)
		}
		this.spatialIndex.finish()
		console.timeEnd("WayIndex.buildSpatialIndex")
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

	getBbox(index: number): GeoBbox2D {
		return [
			this.bbox.at(index * 4),
			this.bbox.at(index * 4 + 1),
			this.bbox.at(index * 4 + 2),
			this.bbox.at(index * 4 + 3),
		]
	}

	getLine(index: number) {
		const count = this.refCount.at(index)
		const start = this.refStart.at(index)
		const line = new Float64Array(count * 2)
		for (let i = 0; i < count; i++) {
			const ref = this.refs.at(start + i)
			const [lon, lat] = this.nodeIndex.getNodeLonLat({ id: ref })
			line[i * 2] = lon
			line[i * 2 + 1] = lat
		}
		return line
	}

	getCoordinates(index: number): [number, number][] {
		const line = this.getLine(index)
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

	getLineString(i: IdOrIndex): GeoJSON.Feature<GeoJSON.LineString, OsmTags> {
		const [index, id] = this.ids.idOrIndex(i)
		const coordinates = this.getCoordinates(index)
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
		console.time("WayIndex.intersects")
		const results = this.spatialIndex.search(bbox[0], bbox[1], bbox[2], bbox[3])
		console.timeEnd("WayIndex.intersects")
		return results
	}
}
