import KDBush from "kdbush"
import type { OsmNode } from "./types"

export default class NodeSpatialIndex {
	#nodes: Map<number, OsmNode>
	#nodeIds: number[] = []
	#index: KDBush

	constructor(nodes: Map<number, OsmNode>) {
		this.#nodes = nodes
		console.time("osm.ts: nodeIndex")
		this.#nodeIds = Array.from(nodes.keys())
		this.#index = new KDBush(this.#nodeIds.length)
		for (const nodeId of this.#nodeIds) {
			const node = nodes.get(nodeId)
			if (!node) continue
			this.#index.add(node.lon, node.lat)
		}
		this.#index.finish()
		console.timeEnd("osm.ts: nodeIndex")
	}

	nodeIndexToNode(index: number) {
		const id = this.#nodeIds[index]
		if (id == null) throw new Error("Node ID is null")
		const node = this.#nodes.get(id)
		if (!node) throw new Error("Node not found")
		return node
	}

	findNeighborsWithin(node: OsmNode, radius = 0) {
		const ids = this.#index.within(node.lon, node.lat, radius)
		return ids
			.map((i) => this.nodeIndexToNode(i))
			.filter((n) => {
				return n.id !== node.id
			})
	}

	nodesWithin(x: number, y: number, radius = 0) {
		const ids = this.#index.within(x, y, radius)
		return ids.map((i) => this.nodeIndexToNode(i))
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
	index: NodeSpatialIndex,
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
