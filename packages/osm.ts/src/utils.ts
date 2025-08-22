import { dequal } from "dequal/lite"
import type {
	LonLat,
	OsmEntityType,
	OsmNode,
	OsmRelation,
	OsmWay,
	OsmEntity,
	OsmTags,
} from "./types"
import { lineIntersect } from "@turf/turf"

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

export function entityPropertiesEqual(a: OsmEntity, b: OsmEntity) {
	if (!dequal(a.tags, b.tags)) return false
	if (!dequal(a.info, b.info)) return false
	if (isNode(a) && isNode(b)) return isNodeEqual(a, b)
	if (isWay(a) && isWay(b)) return isWayEqual(a, b)
	if (isRelation(a) && isRelation(b)) return isRelationEqual(a, b)
	return false
}

export function getEntityType(entity: OsmEntity): OsmEntityType {
	if (isNode(entity)) return "node"
	if (isWay(entity)) return "way"
	if (isRelation(entity)) return "relation"
	throw Error("Unknown entity type")
}

export function throttle<T extends unknown[]>(
	func: (...args: T) => void,
	timeFrame: number,
) {
	let lastTime = 0
	return (...args: T) => {
		const now = Date.now()
		if (now - lastTime >= timeFrame) {
			func(...args)
			lastTime = now
		}
	}
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

export function wayIntersections(
	way1: Float64Array,
	way2: Float64Array,
): LonLat[] {
	const [line1, line2] = [way1, way2].map((way) => {
		const coordinates: [number, number][] = []
		for (let i = 0; i < way.length; i += 2) {
			coordinates.push([way[i], way[i + 1]])
		}
		return {
			type: "Feature",
			geometry: {
				type: "LineString",
				coordinates,
			},
			properties: {},
		} as GeoJSON.Feature<GeoJSON.LineString>
	})
	const intersectionPoints = lineIntersect(line1, line2)
	return intersectionPoints.features.map((f) => ({
		lon: f.geometry.coordinates[0],
		lat: f.geometry.coordinates[1],
	}))
}

export function osmTagsToOscTags(tags: OsmTags): string {
	return Object.entries(tags)
		.map(([key, value]) => {
			return `<tag k="${key}" v="${value}" />`
		})
		.join("")
}
