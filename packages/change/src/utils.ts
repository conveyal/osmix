import type { OsmRelation, OsmTags, OsmWay } from "@osmix/json"
import type { OsmixChangesetStats } from "./types"

/**
 * Calculate the haversine distance between two LonLat points.
 * @param p1 - The first point
 * @param p2 - The second point
 * @returns The haversine distance in meters
 */
export function haversineDistance(
	p1: [number, number],
	p2: [number, number],
): number {
	const R = 6371008.8 // Earth's radius in meters
	const dLat = (p2[1] - p1[1]) * (Math.PI / 180)
	const dLon = (p2[0] - p1[0]) * (Math.PI / 180)
	const lat1 = p1[1] * (Math.PI / 180)
	const lat2 = p2[1] * (Math.PI / 180)
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
export function removeDuplicateAdjacentWayRefs(way: OsmWay) {
	return {
		...way,
		refs: way.refs.filter((ref, index, array) => {
			return ref !== array[index + 1]
		}),
	}
}

/**
 * Remove duplicate relation members back to back, but not when they are separated by other members
 * @param relation
 * @returns relation with duplicate members back to back removed
 */
export function removeDuplicateAdjacentRelationMembers(relation: OsmRelation) {
	return {
		...relation,
		members: relation.members.filter((member, index, array) => {
			return member.ref !== array[index + 1]?.ref
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

export function camelCaseToSentenceCase(str: string) {
	return str
		.replace(/([A-Z])/g, " $1")
		.trim()
		.toLowerCase()
}

/**
 * Summarize the changeset stats with the most significant changes first.
 */
export function changeStatsSummary(stats: OsmixChangesetStats) {
	const numericStats = (Object.entries(stats) as [string, unknown][]).filter(
		([, value]) => typeof value === "number" && value > 0,
	) as [string, number][]
	if (numericStats.length === 0) return "Changeset is empty."
	const sortedNumericStats = [...numericStats]
		.sort((a, b) => b[1] - a[1])
		.map(
			([key, value]) =>
				` ${camelCaseToSentenceCase(key)}: ${value.toLocaleString()}`,
		)
	return `Changeset summary: ${sortedNumericStats.join(", ")}`
}
