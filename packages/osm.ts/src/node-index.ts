import KDBush from "kdbush"
import { ResizeableCoordinateArray } from "./typed-arrays"
import type { GeoBbox2D, OsmNode, OsmTags } from "./types"
import { EntityIndex, type IdOrIndex } from "./entity-index"
import type StringTable from "./stringtable"
import type { OsmPbfDenseNodes, OsmPbfPrimitiveBlock } from "./pbf"

export class NodeIndex extends EntityIndex<OsmNode> {
	lons = new ResizeableCoordinateArray()
	lats = new ResizeableCoordinateArray()
	bbox: GeoBbox2D = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	]
	spatialIndex: KDBush = new KDBush(0)

	constructor(stringTable: StringTable) {
		super(stringTable, "node")
	}

	addNode(node: OsmNode) {
		super.add(node.id)
		this.addTags(node.tags)

		this.lons.push(node.lon)
		this.lats.push(node.lat)

		if (node.lon < this.bbox[0]) this.bbox[0] = node.lon
		if (node.lat < this.bbox[1]) this.bbox[1] = node.lat
		if (node.lon > this.bbox[2]) this.bbox[2] = node.lon
		if (node.lat > this.bbox[3]) this.bbox[3] = node.lat
	}

	addDenseNodes(dense: OsmPbfDenseNodes, block: OsmPbfPrimitiveBlock) {
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

		const getStringTableIndex = (index: number) => {
			const key = dense.keys_vals[index]
			if (!key) return
			const blockString = block.stringtable[key]
			return this.stringTable.add(blockString)
		}

		let keysValsIndex = 0
		for (let i = 0; i < dense.id.length; i++) {
			const idSid = dense.id[i]
			const latSid = dense.lat[i]
			const lonSid = dense.lon[i]

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

			super.add(delta.id)
			this.lons.push(lon)
			this.lats.push(lat)

			if (lon < this.bbox[0]) this.bbox[0] = lon
			if (lat < this.bbox[1]) this.bbox[1] = lat
			if (lon > this.bbox[2]) this.bbox[2] = lon
			if (lat > this.bbox[3]) this.bbox[3] = lat
			this.addTagKeysAndValues(tagKeys, tagValues)
		}
	}

	finishEntityIndex() {
		this.lons.compact()
		this.lats.compact()
		this.buildSpatialIndex()
	}

	buildSpatialIndex() {
		console.time("NodeIndex.buildSpatialIndex")
		this.spatialIndex = new KDBush(this.size)
		for (let i = 0; i < this.size; i++) {
			this.spatialIndex.add(this.lons.at(i), this.lats.at(i))
		}
		this.spatialIndex.finish()
		console.timeEnd("NodeIndex.buildSpatialIndex")
	}

	getNodeLonLat(i: IdOrIndex): [number, number] {
		const [index] = this.idOrIndex(i)
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

	set(_: OsmNode) {
		throw Error("NodeIndex.set not implemented yet")
	}

	// Spatial operations

	within(bbox: GeoBbox2D): number[]
	within(x: number, y: number, radius?: number): number[]
	within(bbox: GeoBbox2D | number, y?: number, radius = 0): number[] {
		if (Array.isArray(bbox)) {
			return this.spatialIndex.range(bbox[0], bbox[1], bbox[2], bbox[3])
		}
		if (y !== undefined) {
			return this.spatialIndex.within(bbox, y, radius)
		}
		throw Error("Invalid arguments")
	}

	findNeighborsWithin(node: OsmNode, radius = 0): OsmNode[] {
		const nodeIndexes = this.spatialIndex.within(node.lon, node.lat, radius)
		return this.getEntitiesByIndex(nodeIndexes).filter((n) => n.id !== node.id)
	}

	/* within(x: number, y: number, radius = 0): OsmNode[] {
		const nodeIndexes = this.spatialIndex.within(x, y, radius)
		return this.getEntitiesByIndex(nodeIndexes)
	}*/

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
