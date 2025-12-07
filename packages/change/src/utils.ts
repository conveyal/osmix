/**
 * Utility functions for changeset operations.
 *
 * Provides helpers for:
 * - Tag formatting (OSC XML)
 * - Duplicate detection and removal
 * - Way intersection detection
 * - Entity comparison
 *
 * @module
 */

import { haversineDistance } from "@osmix/shared/haversine-distance"
import type {
	OsmEntity,
	OsmRelation,
	OsmTags,
	OsmWay,
} from "@osmix/shared/types"
import sweeplineIntersections from "sweepline-intersections"
import type { OsmChangesetStats } from "./types"

/**
 * Convert OSM tags object to OSC XML tag elements.
 * @param tags - The tags to convert.
 * @returns XML string of `<tag k="..." v="..." />` elements.
 */
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

/**
 * Filter adjacent coordinates that are identical.
 */
export function cleanCoords(coords: [number, number][]) {
	return coords.filter((coord, index, array) => {
		if (index === array.length - 1) return true
		return (
			coord[0] !== array[index + 1]?.[0] || coord[1] !== array[index + 1]?.[1]
		)
	})
}

/**
 * Check if an entity has a specific tag with a specific value.
 * @param entity - The OSM entity to check.
 * @param tag - The tag key to look for.
 * @param value - The expected tag value.
 * @returns True if the entity has the tag with the specified value.
 */
export function entityHasTagValue(
	entity: OsmEntity,
	tag: string,
	value: string,
) {
	return entity.tags?.[tag] === value
}

const isHighway = (t: OsmTags) => t["highway"] != null
const isFootish = (t: OsmTags) =>
	["footway", "path", "cycleway", "bridleway", "steps"].includes(
		String(t["highway"]),
	)
const isPolygonish = (t: OsmTags) =>
	!!(t["building"] || t["landuse"] || t["natural"])

/**
 * Determine if two ways should be connected based on their tags.
 * Connection logic:
 * - Never connect if either is an area (building, landuse, etc).
 * - Never connect if separated by bridge/tunnel/layer.
 * - Connect highway-highway, highway-footway, footway-footway.
 */
export function waysShouldConnect(tagsA?: OsmTags, tagsB?: OsmTags) {
	const a = tagsA || {}
	const b = tagsB || {}
	if (isPolygonish(a) || isPolygonish(b)) return false

	const isSeparated = !!(
		a["bridge"] ||
		a["tunnel"] ||
		b["bridge"] ||
		b["tunnel"]
	)
	const diffLayer = (a["layer"] ?? "0") !== (b["layer"] ?? "0")
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

/**
 * Convert camelCase string to sentence case.
 * @param str - The camelCase string.
 * @returns The string in sentence case (e.g., "deduplicatedNodes" -> "deduplicated nodes").
 */
export function camelCaseToSentenceCase(str: string) {
	return str
		.replace(/([A-Z])/g, " $1")
		.trim()
		.toLowerCase()
}

/**
 * Summarize the changeset stats with the most significant changes first.
 */
export function changeStatsSummary(stats: OsmChangesetStats) {
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

/**
 * Check if the coordinates of two ways produce intersections.
 * Uses `sweepline-intersections` for robust detection.
 * Returns unique intersection points as [lon, lat] tuples.
 */
export function waysIntersect(
	wayA: [number, number][],
	wayB: [number, number][],
): [number, number][] {
	const intersections = sweeplineIntersections(
		{
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: wayA,
					},
					properties: {},
				},
				{
					type: "Feature",
					geometry: {
						type: "LineString",
						coordinates: wayB,
					},
					properties: {},
				},
			],
		},
		true,
	)

	const uniqueFeatures: [number, number][] = []
	const seen = new Set<string>()

	for (const coordinates of intersections) {
		const key = `${coordinates[0]}:${coordinates[1]}`
		if (seen.has(key)) continue
		seen.add(key)
		uniqueFeatures.push(coordinates)
	}

	return uniqueFeatures
}

/**
 * Find the nearest Node ref on a way to a given point.
 * Used when splicing a node into an existing way.
 */
export function nearestNodeOnWay(
	way: OsmWay,
	wayCoords: [number, number][],
	point: [number, number],
	MAX_DISTANCE_METERS = 1,
) {
	let nearestDistance = Number.POSITIVE_INFINITY
	let nearestNodeId = null
	let nearestNodeRefIndex = -1
	wayCoords.forEach((wayCoord, i) => {
		const nodeDistance = haversineDistance(wayCoord, point)
		if (nodeDistance < nearestDistance && nodeDistance < MAX_DISTANCE_METERS) {
			nearestDistance = nodeDistance
			nearestNodeId = way.refs[i]
			nearestNodeRefIndex = i
		}
	})
	return {
		refIndex: nearestNodeRefIndex,
		nodeId: nearestNodeId,
	}
}

/**
 * Get the version of an entity.
 */
export function getEntityVersion(entity: OsmEntity) {
	return entity.tags && "ext:osm_version" in entity.tags
		? Number(entity.tags["ext:osm_version"])
		: 0
}
