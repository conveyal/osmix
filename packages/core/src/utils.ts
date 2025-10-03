import type { LonLat, OsmNode, OsmTags, OsmWay } from "@osmix/json"
import type { GeoBbox2D } from "./types"

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

export function osmTagsToOscTags(tags: OsmTags): string {
	return Object.entries(tags)
		.map(([key, value]) => {
			return `<tag k="${key}" v="${value}" />`
		})
		.join("")
}
/**
 * Remove duplicate refs back to back, but not when they are separated by other refs
 * @param way
 * @returns way with duplicate refs back to back removed
 */
export function removeDuplicateAdjacentOsmWayRefs(way: OsmWay) {
	return {
		...way,
		refs: way.refs.filter((ref, index, array) => {
			return ref !== array[index + 1]
		}),
	}
}
export function cleanCoords(coords: [number, number][]) {
	return coords.filter((coord, index, array) => {
		if (index === array.length - 1) return true
		return coord[0] !== array[index + 1][0] || coord[1] !== array[index + 1][1]
	})
}
const isHighway = (t: OsmTags) => t.highway != null
const isFootish = (t: OsmTags) =>
	["footway", "path", "cycleway", "bridleway", "steps"].includes(
		String(t.highway),
	)
const isPolygonish = (t: OsmTags) => !!(t.building || t.landuse || t.natural)

/**
 * Determine if two ways should be connected based on their tags
 */
export function waysShouldConnect(tagsA?: OsmTags, tagsB?: OsmTags) {
	const a = tagsA || {}
	const b = tagsB || {}
	if (isPolygonish(a) || isPolygonish(b)) return false

	const isSeparated = !!(a.bridge || a.tunnel || b.bridge || b.tunnel)
	const diffLayer = (a.layer ?? "0") !== (b.layer ?? "0")
	if (isSeparated || diffLayer) return false

	if (isHighway(a) && isHighway(b)) return true
	if (isHighway(a) && isFootish(b)) return true
	if (isHighway(b) && isFootish(a)) return true
	if (isFootish(a) && isFootish(b)) return true

	return false
}
/**
 * Determine if a way is a candidate for connecting to another way
 */
export function isWayIntersectionCandidate(way: OsmWay) {
	return (
		way.tags &&
		(isHighway(way.tags) || isFootish(way.tags)) &&
		!isPolygonish(way.tags)
	)
}

export function bboxFromLonLats(lonLats: LonLat[]): GeoBbox2D {
	let minLon = Number.POSITIVE_INFINITY
	let minLat = Number.POSITIVE_INFINITY
	let maxLon = Number.NEGATIVE_INFINITY
	let maxLat = Number.NEGATIVE_INFINITY
	for (const lonLat of lonLats) {
		if (lonLat.lon < minLon) minLon = lonLat.lon
		if (lonLat.lat < minLat) minLat = lonLat.lat
		if (lonLat.lon > maxLon) maxLon = lonLat.lon
		if (lonLat.lat > maxLat) maxLat = lonLat.lat
	}
	return [minLon, minLat, maxLon, maxLat]
}
