import { dequal } from "dequal/lite"
import type {
	OsmEntity,
	OsmEntityType,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "./types"

function isTagsAndInfoEqual(a: OsmEntity, b: OsmEntity) {
	return dequal(a.tags, b.tags) && dequal(a.info, b.info)
}

export function isNode(entity: OsmEntity): entity is OsmNode {
	return "lon" in entity && "lat" in entity
}

export function isNodeEqual(a: OsmNode, b: OsmNode) {
	return a.lat === b.lat && a.lon === b.lon && isTagsAndInfoEqual(a, b)
}

export function isWay(entity: OsmEntity): entity is OsmWay {
	return "refs" in entity
}

export function isRelation(entity: OsmEntity): entity is OsmRelation {
	return "members" in entity
}

export function isWayEqual(a: OsmWay, b: OsmWay) {
	return dequal(a.refs, b.refs) && isTagsAndInfoEqual(a, b)
}

export function isRelationEqual(a: OsmRelation, b: OsmRelation) {
	return dequal(a.members, b.members) && isTagsAndInfoEqual(a, b)
}

export function getEntityType(entity: OsmEntity): OsmEntityType {
	if (isNode(entity)) return "node"
	if (isWay(entity)) return "way"
	if (isRelation(entity)) return "relation"
	throw Error("Unknown entity type")
}

/**
 * Create a throttled console.log which prints at most once every `ms`.
 * @param ms - The minimum time between logs in milliseconds
 * @returns A function that can be called to log a value
 */
export function logEvery(ms: number) {
	const start = Date.now()
	let prev = start // previously allowed timestamp
	return (val: unknown) => {
		const now = Date.now()
		if (now >= prev + ms) {
			console.error(`${(now - start) / 1000}s: ${val}`)
			prev = now
		}
	}
}

/**
 * Calculate the haversine distance between two nodes.
 * @param node1 - The first node
 * @param node2 - The second node
 * @returns The haversine distance in kilometers
 */
export function haversineDistance(node1: OsmNode, node2: OsmNode): number {
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
