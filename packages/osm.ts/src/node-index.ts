import KDBush from "kdbush"
import {
	BufferConstructor,
	CoordinateArrayType,
	ResizeableTypedArray,
	type TypedArrayBuffer,
} from "./typed-arrays"
import type { GeoBbox2D, OsmNode, OsmTags } from "./types"
import { EntityIndex, type EntityIndexTransferables } from "./entity-index"
import type StringTable from "./stringtable"
import type { OsmPbfDenseNodes, OsmPbfPrimitiveBlock } from "./pbf"
import { IdIndex, type IdOrIndex } from "./id-index"
import { TagIndex } from "./tag-index"

export interface NodeIndexTransferables extends EntityIndexTransferables {
	lons: TypedArrayBuffer
	lats: TypedArrayBuffer
	bbox: GeoBbox2D
	spatialIndex: TypedArrayBuffer
}

export class NodeIndex extends EntityIndex<OsmNode> {
	lons = new ResizeableTypedArray(CoordinateArrayType)
	lats = new ResizeableTypedArray(CoordinateArrayType)
	bbox: GeoBbox2D = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	]
	spatialIndex: KDBush = new KDBush(0)

	static from(stringTable: StringTable, nits: NodeIndexTransferables) {
		const idIndex = IdIndex.from(nits)
		const tagIndex = TagIndex.from(stringTable, nits)
		const nodeIndex = new NodeIndex(stringTable, idIndex, tagIndex)
		nodeIndex.lons = ResizeableTypedArray.from(Float64Array, nits.lons)
		nodeIndex.lats = ResizeableTypedArray.from(Float64Array, nits.lats)
		nodeIndex.bbox = nits.bbox
		nodeIndex.spatialIndex = KDBush.from(nits.spatialIndex)
		return nodeIndex
	}

	constructor(
		stringTable: StringTable,
		idIndex?: IdIndex,
		tagIndex?: TagIndex,
	) {
		super("node", stringTable, idIndex, tagIndex)
	}

	transferables(): NodeIndexTransferables {
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
		block: OsmPbfPrimitiveBlock,
		blockStringIndexMap: Map<number, number>,
	) {
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
			if (!key) return
			const index = blockStringIndexMap.get(key)
			if (index === undefined) throw Error("Block string not found")
			return index
		}

		let keysValsIndex = 0
		for (let i = 0; i < dense.id.length; i++) {
			const idSid = dense.id[i]
			const latSid = dense.lat[i]
			const lonSid = dense.lon[i]

			if (idSid === undefined) throw Error("Dense node ID not found")
			if (latSid === undefined) throw Error("Dense node lat not found")
			if (lonSid === undefined) throw Error("Dense node lon not found")

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

			this.ids.add(delta.id)
			this.lons.push(lon)
			this.lats.push(lat)

			if (lon < this.bbox[0]) this.bbox[0] = lon
			if (lat < this.bbox[1]) this.bbox[1] = lat
			if (lon > this.bbox[2]) this.bbox[2] = lon
			if (lat > this.bbox[3]) this.bbox[3] = lat
			this.tags.addTagKeysAndValues(tagKeys, tagValues)
		}
	}

	finishEntityIndex() {
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
		const [index] = this.ids.idOrIndex(i)
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
		console.time("NodeIndex.withinBbox")
		const results = this.spatialIndex.range(bbox[0], bbox[1], bbox[2], bbox[3])
		console.timeEnd("NodeIndex.withinBbox")
		return results
	}

	withinRadius(x: number, y: number, radius: number): number[] {
		return this.spatialIndex.within(x, y, radius)
	}

	findNeighborsWithin(node: OsmNode, radius = 0): OsmNode[] {
		const nodeIndexes = this.spatialIndex.within(node.lon, node.lat, radius)
		return this.getEntitiesByIndex(nodeIndexes).filter((n) => n.id !== node.id)
	}

	findOverlappingNodes(nodes: OsmNode[], radius = 0) {
		return findOverlappingNodes(this, nodes, radius)
	}
}

/**
 * Find nodes that are within a certain radius of each other.
 * @param index The index to search in.
 * @param nodes The nodes to search for.
 * @param radius The radius to search for. Defaults to 0, which means the nodes must be at the same location.
 * @returns A map of node IDs to sets of node IDs that are within the radius.
 */
export function findOverlappingNodes(
	index: NodeIndex,
	nodes: OsmNode[],
	radius = 0,
) {
	const overlapping = new Map<number, Set<number>>()
	for (const node of nodes) {
		const closeNodes = index.findNeighborsWithin(node, radius)
		if (closeNodes.length === 0) continue
		const overlappingNodes = new Set<number>()
		for (const closeNode of closeNodes) {
			if (overlapping.has(closeNode.id)) {
				overlapping.get(closeNode.id)?.add(node.id)
			} else {
				overlappingNodes.add(closeNode.id)
			}
		}
		if (overlappingNodes.size > 0) {
			overlapping.set(node.id, overlappingNodes)
		}
	}
	return overlapping
}
