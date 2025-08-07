import { EntityIndex } from "./entity-index"
import type { GeoBbox2D, OsmTags, OsmWay } from "./types"
import { ResizeableCoordinateArray, ResizeableTypedArray } from "./typed-arrays"
import type { NodeIndex } from "./node-index"
import type StringTable from "./stringtable"
import Flatbush from "flatbush"
import type { OsmPbfPrimitiveBlock, OsmPbfWay } from "./pbf"

export class WayIndex extends EntityIndex<OsmWay> {
	spatialIndex: Flatbush = new Flatbush(1)

	refStartByIndex = new ResizeableTypedArray(Uint32Array)
	refCountByIndex = new ResizeableTypedArray(Uint16Array) // Maximum 2,000 nodes per way

	// Store the index of the node in the node index. Not the ID
	refIndexes = new ResizeableTypedArray(Uint32Array)

	// Bounding box of the way in geographic coordinates
	bbox = new ResizeableCoordinateArray()

	// WayIndex is dependent on a NodeIndex
	nodeIndex: NodeIndex

	constructor(stringTable: StringTable, nodeIndex: NodeIndex) {
		super(stringTable, "way")
		this.nodeIndex = nodeIndex
	}

	addWay(way: OsmWay) {
		super.add(way.id)
		this.addTags(way.tags)
		this.refStartByIndex.push(this.refIndexes.length)
		this.refCountByIndex.push(way.refs.length)
		const bbox = [
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]
		for (const ref of way.refs) {
			const index = this.nodeIndex.getIndexFromId(ref)
			this.refIndexes.push(index)
			const lon = this.nodeIndex.lons.at(index)
			const lat = this.nodeIndex.lats.at(index)
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
			super.add(way.id)

			let refId = 0
			const bbox = [
				Number.POSITIVE_INFINITY,
				Number.POSITIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
			]
			this.refStartByIndex.push(this.refIndexes.length)
			this.refCountByIndex.push(way.refs.length)

			for (const refSid of way.refs) {
				refId += refSid
				const nodeIndex = this.nodeIndex.getIndexFromId(refId)
				this.refIndexes.push(nodeIndex)
				const lon = this.nodeIndex.lons.at(nodeIndex)
				const lat = this.nodeIndex.lats.at(nodeIndex)
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
			this.addTagKeysAndValues(tagKeys, tagValues)
		}
	}

	finishEntityIndex() {
		this.refStartByIndex.compact()
		this.refCountByIndex.compact()
		this.refIndexes.compact()
		this.bbox.compact()
		this.buildSpatialIndex()
	}

	buildSpatialIndex() {
		console.time("WayIndex.buildSpatialIndex")
		this.spatialIndex = new Flatbush(this.size)
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

	getRefIndexes(index: number): Uint32Array {
		const start = this.refStartByIndex.at(index)
		const count = this.refCountByIndex.at(index)
		const refs = new ResizeableTypedArray(Uint32Array)
		for (let i = start; i < start + count; i++) {
			refs.push(this.refIndexes.at(i))
		}
		return refs.compact()
	}

	getRefIds(index: number): number[] {
		const refs = this.getRefIndexes(index)
		return Array.from(refs).map((r) => this.nodeIndex.idByIndex.at(r))
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
		const refs = this.getRefIndexes(index)
		const line = new Float64Array(refs.length * 2)
		for (let i = 0; i < refs.length; i++) {
			const ref = refs.at(i)
			if (ref == null) continue
			line[i * 2] = this.nodeIndex.lons.at(ref)
			line[i * 2 + 1] = this.nodeIndex.lats.at(ref)
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

	getLineString(
		i: { index: number } | { id: number },
	): GeoJSON.Feature<GeoJSON.LineString, OsmTags> {
		const [index, id] = this.idOrIndex(i)
		return {
			type: "Feature",
			geometry: {
				type: "LineString",
				coordinates: this.getCoordinates(index),
			},
			id,
			properties: this.getTags(index) ?? {},
		}
	}

	set(_: OsmWay) {
		throw Error("WayIndex.set not implemented yet")
	}

	intersects(bbox: GeoBbox2D): number[] {
		return this.spatialIndex.search(bbox[0], bbox[1], bbox[2], bbox[3])
	}
}
