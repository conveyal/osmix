import { EntityIndex } from "./entity-index"
import type { GeoBbox2D, OsmTags, OsmWay } from "./types"
import {
	ResizeableCoordinateArray,
	ResizeableIdArray,
	ResizeableTypedArray,
} from "./typed-arrays"
import type { NodeIndex } from "./node-index"
import type StringTable from "./stringtable"
import Flatbush from "flatbush"
import type { OsmPbfPrimitiveBlock, OsmPbfWay } from "./pbf"
import type { IdOrIndex } from "./id-index"

export class WayIndex extends EntityIndex<OsmWay> {
	spatialIndex: Flatbush = new Flatbush(1)

	refStartByIndex = new ResizeableTypedArray(Uint32Array)
	refCountByIndex = new ResizeableTypedArray(Uint16Array) // Maximum 2,000 nodes per way

	// Node IDs
	refs = new ResizeableIdArray()

	// Bounding box of the way in geographic coordinates
	bbox = new ResizeableCoordinateArray()

	// WayIndex is dependent on a NodeIndex
	nodeIndex: NodeIndex

	constructor(stringTable: StringTable, nodeIndex: NodeIndex) {
		super(stringTable, "way")
		this.nodeIndex = nodeIndex
	}

	addWay(way: OsmWay) {
		this.ids.add(way.id)
		this.tags.addTags(way.tags)
		this.refStartByIndex.push(this.refs.length)
		this.refCountByIndex.push(way.refs.length)
		const bbox = [
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
	addWays(ways: OsmPbfWay[], block: OsmPbfPrimitiveBlock) {
		for (const way of ways) {
			this.ids.add(way.id)

			let refId = 0
			const bbox = [
				Number.POSITIVE_INFINITY,
				Number.POSITIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
			]
			this.refStartByIndex.push(this.refs.length)
			this.refCountByIndex.push(way.refs.length)

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

			const tagKeys: number[] = way.keys.map((key) =>
				this.stringTable.add(block.stringtable[key]),
			)
			const tagValues: number[] = way.vals.map((val) =>
				this.stringTable.add(block.stringtable[val]),
			)
			this.tags.addTagKeysAndValues(tagKeys, tagValues)
		}
	}

	finishEntityIndex() {
		this.refStartByIndex.compact()
		this.refCountByIndex.compact()
		this.refs.compact()
		this.bbox.compact()
		this.buildSpatialIndex()
	}

	buildSpatialIndex() {
		console.time("WayIndex.buildSpatialIndex")
		this.spatialIndex = new Flatbush(this.size, 128)
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
		const start = this.refStartByIndex.at(index)
		const count = this.refCountByIndex.at(index)
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
		const count = this.refCountByIndex.at(index)
		const start = this.refStartByIndex.at(index)
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
			coords.push([line[i], line[i + 1]])
		}
		return coords
	}

	getLineString(i: IdOrIndex): GeoJSON.Feature<GeoJSON.LineString, OsmTags> {
		const [index, id] = this.ids.idOrIndex(i)
		const line = this.getLine(index)
		const coordinates: [number, number][] = []
		for (let i = 0; i < line.length; i += 2) {
			coordinates.push([line[i], line[i + 1]])
		}
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
