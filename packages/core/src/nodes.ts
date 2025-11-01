import type { OsmNode, OsmTags } from "@osmix/json"
import type { OsmPbfBlock, OsmPbfDenseNodes } from "@osmix/pbf"
import { assertValue } from "@osmix/shared/assert"
import type { GeoBbox2D } from "@osmix/shared/types"
import KDBush from "kdbush"
import { Entities, type EntitiesTransferables } from "./entities"
import { type IdOrIndex, Ids } from "./ids"
import type StringTable from "./stringtable"
import { Tags } from "./tags"
import {
	BufferConstructor,
	type BufferType,
	CoordinateArrayType,
	ResizeableTypedArray,
} from "./typed-arrays"

export interface NodesTransferables extends EntitiesTransferables {
	lons: BufferType
	lats: BufferType
	bbox: GeoBbox2D
	spatialIndex: BufferType
}

export interface AddNodeOptions {
	filter?: (node: OsmNode) => boolean
}

export class Nodes extends Entities<OsmNode> {
	lons: ResizeableTypedArray<Float64Array>
	lats: ResizeableTypedArray<Float64Array>
	bbox: GeoBbox2D = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	]
	spatialIndex: KDBush = new KDBush(0, 128, Float64Array, BufferConstructor)

	static from(stringTable: StringTable, nits: NodesTransferables) {
		const idIndex = Ids.from(nits)
		const tagIndex = Tags.from(stringTable, nits)
		const nodeIndex = new Nodes(stringTable, idIndex, tagIndex)
		nodeIndex.lons = ResizeableTypedArray.from(CoordinateArrayType, nits.lons)
		nodeIndex.lats = ResizeableTypedArray.from(CoordinateArrayType, nits.lats)
		nodeIndex.bbox = nits.bbox
		nodeIndex.spatialIndex = KDBush.from(nits.spatialIndex)
		return nodeIndex
	}

	constructor(stringTable: StringTable, idIndex?: Ids, tagIndex?: Tags) {
		super("node", stringTable, idIndex, tagIndex)
		this.lons = new ResizeableTypedArray(CoordinateArrayType)
		this.lats = new ResizeableTypedArray(CoordinateArrayType)
	}

	transferables(): NodesTransferables {
		return {
			lons: this.lons.array.buffer,
			lats: this.lats.array.buffer,
			bbox: this.bbox,
			spatialIndex: this.spatialIndex.data,
			...this.ids.transferables(),
			...this.tags.transferables(),
		}
	}

	addNode(node: OsmNode) {
		this.ids.add(node.id)
		this.tags.addTags(node.tags)

		this.lons.push(node.lon)
		this.lats.push(node.lat)

		if (node.lon < this.bbox[0]) this.bbox[0] = node.lon
		if (node.lat < this.bbox[1]) this.bbox[1] = node.lat
		if (node.lon > this.bbox[2]) this.bbox[2] = node.lon
		if (node.lat > this.bbox[3]) this.bbox[3] = node.lat
	}

	addDenseNodes(
		dense: OsmPbfDenseNodes,
		block: OsmPbfBlock,
		blockStringIndexMap: Map<number, number>,
		filter?: (node: OsmNode) => boolean,
	): number {
		const lon_offset = block.lon_offset ?? 0
		const lat_offset = block.lat_offset ?? 0
		const granularity = block.granularity ?? 1e7
		const delta = {
			id: 0,
			lat: 0,
			lon: 0,
			timestamp: 0,
			changeset: 0,
			uid: 0,
			user_sid: 0,
		}

		const getStringTableIndex = (keyIndex: number) => {
			const key = dense.keys_vals[keyIndex]
			assertValue(key, "Block string key is undefined")
			const index = blockStringIndexMap.get(key)
			assertValue(index, "Block string not found")
			return index
		}

		let keysValsIndex = 0
		let added = 0
		for (let i = 0; i < dense.id.length; i++) {
			const idSid = dense.id[i]
			const latSid = dense.lat[i]
			const lonSid = dense.lon[i]
			assertValue(idSid, "ID SID is undefined")
			assertValue(latSid, "Latitude SID is undefined")
			assertValue(lonSid, "Longitude SID is undefined")

			delta.id += idSid
			delta.lat += latSid
			delta.lon += lonSid

			const lon = lon_offset + delta.lon / granularity
			const lat = lat_offset + delta.lat / granularity

			const tagKeys: number[] = []
			const tagValues: number[] = []
			if (dense.keys_vals.length > 0) {
				while (dense.keys_vals[keysValsIndex] !== 0) {
					const key = getStringTableIndex(keysValsIndex)
					const val = getStringTableIndex(keysValsIndex + 1)
					if (key && val) {
						tagKeys.push(key)
						tagValues.push(val)
					}
					keysValsIndex += 2
				}
				keysValsIndex++
			}

			const shouldInclude = filter
				? filter({
						id: delta.id,
						lon,
						lat,
						tags: this.tags.getTagsFromIndices(tagKeys, tagValues),
					})
				: true
			if (!shouldInclude) continue

			this.ids.add(delta.id)
			this.lons.push(lon)
			this.lats.push(lat)

			if (lon < this.bbox[0]) this.bbox[0] = lon
			if (lat < this.bbox[1]) this.bbox[1] = lat
			if (lon > this.bbox[2]) this.bbox[2] = lon
			if (lat > this.bbox[3]) this.bbox[3] = lat
			this.tags.addTagKeysAndValues(tagKeys, tagValues)
			added++
		}

		return added
	}

	buildEntityIndex() {
		this.lons.compact()
		this.lats.compact()
	}

	buildSpatialIndex() {
		console.time("NodeIndex.buildSpatialIndex")
		this.spatialIndex = new KDBush(
			this.size,
			128,
			Float64Array,
			BufferConstructor,
		)
		for (let i = 0; i < this.size; i++) {
			this.spatialIndex.add(this.lons.at(i), this.lats.at(i))
		}
		this.spatialIndex.finish()
		console.timeEnd("NodeIndex.buildSpatialIndex")
	}

	getNodeLonLat(i: IdOrIndex): [number, number] {
		const index = "index" in i ? i.index : this.ids.idOrIndex(i)[0]
		return [this.lons.at(index), this.lats.at(index)]
	}

	getFullEntity(index: number, id: number, tags?: OsmTags): OsmNode {
		const [lon, lat] = this.getNodeLonLat({ index })
		if (tags) {
			return {
				id,
				lat,
				lon,
				tags,
			}
		}
		return {
			id,
			lat,
			lon,
		}
	}

	// Spatial operations
	withinBbox(bbox: GeoBbox2D): number[] {
		return this.spatialIndex.range(bbox[0], bbox[1], bbox[2], bbox[3])
	}

	withinRadius(x: number, y: number, radius: number): number[] {
		return this.spatialIndex.within(x, y, radius)
	}
}
