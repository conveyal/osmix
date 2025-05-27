import { Osm } from "./osm"
import type { OsmNode } from "./types"

/**
 * Merge two OSM objects.
 *
 * @param a - The first OSM object
 * @param b - The second OSM object
 * @returns The merged OSM object
 */
export function merge(a: Osm, b: Osm) {
	const osm = new Osm(Object.assign({}, a.header, b.header))
	osm.nodes = a.nodes
	osm.ways = a.ways
	osm.relations = a.relations

	for (const node of b.nodes.values()) {
		if (osm.nodes.has(node.id)) {
			const existingNode = osm.nodes.get(node.id)
			if (existingNode) {
				existingNode.tags = { ...existingNode.tags, ...node.tags }
				existingNode.info = { ...existingNode.info, ...node.info }
				existingNode.lat = node.lat
				existingNode.lon = node.lon
			}
		} else {
			osm.addEntity(node)
		}
	}

	for (const way of b.ways.values()) {
		if (osm.ways.has(way.id)) {
			const existingWay = osm.ways.get(way.id)
			if (existingWay) {
				existingWay.tags = { ...existingWay.tags, ...way.tags }
				existingWay.info = { ...existingWay.info, ...way.info }
				existingWay.refs = way.refs
			}
		} else {
			osm.addEntity(way)
		}
	}

	for (const relation of b.relations.values()) {
		if (osm.relations.has(relation.id)) {
			const existingRelation = osm.relations.get(relation.id)
			if (existingRelation) {
				existingRelation.tags = { ...existingRelation.tags, ...relation.tags }
				existingRelation.info = { ...existingRelation.info, ...relation.info }
				existingRelation.members = relation.members
			}
		} else {
			osm.addEntity(relation)
		}
	}

	// TODO sort

	return osm
}

export function getConflictingIds(a: Osm, b: Osm) {
	const nodes = new Set<number>()
	const ways = new Set<number>()
	const relations = new Set<number>()

	for (const node of b.nodes.values()) {
		if (a.nodes.has(node.id)) {
			nodes.add(node.id)
		}
	}

	for (const way of b.ways.values()) {
		if (a.ways.has(way.id)) {
			ways.add(way.id)
		}
	}

	for (const relation of b.relations.values()) {
		if (a.relations.has(relation.id)) {
			relations.add(relation.id)
		}
	}

	return { nodes, ways, relations }
}

export function getOverlappingNodes(a: Osm, b: Osm) {
	const nodes = new Set<number>()
	for (const node of a.nodes.values()) {
		for (const bNode of b.nodes.values()) {
			if (haversineDistance(node, bNode) < 1) {
				nodes.add(node.id)
			}
		}
	}
	return nodes
}

/**
 * Calculate the haversine distance between two nodes.
 * @param node1 - The first node
 * @param node2 - The second node
 * @returns The haversine distance in kilometers
 */
function haversineDistance(node1: OsmNode, node2: OsmNode): number {
	const R = 6371 // Earth's radius in kilometers
	const dLat = (node2.lat - node1.lat) * (Math.PI / 180)
	const dLon = (node2.lon - node1.lon) * (Math.PI / 180)
	const lat1 = node1.lat * (Math.PI / 180)
	const lat2 = node2.lat * (Math.PI / 180)
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
	return R * c
}
