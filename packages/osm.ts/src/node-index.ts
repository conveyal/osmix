import KDBush from "kdbush"
import { ResizeableCoordinateArray } from "./chunked-array"
import type { GeoBbox2D, OsmNode, OsmTags } from "./types"
import { EntityIndex } from "./entity-index"

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

	add(node: OsmNode) {
		super.add(node)

		this.lons.push(node.lon)
		this.lats.push(node.lat)

		if (node.lon < this.bbox[0]) this.bbox[0] = node.lon
		if (node.lat < this.bbox[1]) this.bbox[1] = node.lat
		if (node.lon > this.bbox[2]) this.bbox[2] = node.lon
		if (node.lat > this.bbox[3]) this.bbox[3] = node.lat
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

	getNodeLonLat(i: { id: number } | { index: number }): [number, number] {
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
