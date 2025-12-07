/**
 * Routing graph construction from OSM data.
 *
 * Builds a directed graph from OSM ways suitable for pathfinding. Edges are
 * created between consecutive nodes in each way, with pre-computed distance
 * and time costs. Respects one-way restrictions.
 *
 * @module
 */

import type { Osm } from "@osmix/core"
import { haversineDistance } from "@osmix/shared/haversine-distance"
import type { LonLat } from "@osmix/shared/types"
import type {
	DefaultSpeeds,
	GraphEdge,
	HighwayFilter,
	RoutingGraph,
} from "./types"
import {
	calculateTime,
	DEFAULT_SPEEDS,
	defaultHighwayFilter,
	getSpeedLimit,
} from "./utils"

/**
 * Build a routing graph from OSM ways.
 *
 * Constructs a directed graph by:
 * 1. Filtering ways by highway type (customizable filter).
 * 2. Creating bidirectional edges between consecutive nodes (unless one-way).
 * 3. Pre-computing distance (meters) and time (seconds) for each edge.
 * 4. Tracking intersections where multiple ways meet.
 *
 * @param osm - The OSM dataset to build from.
 * @param filter - Function to determine which ways are routable.
 * @param defaultSpeeds - Speed limits (km/h) by highway type.
 * @returns A RoutingGraph ready for pathfinding.
 */
export function buildGraph(
	osm: Osm,
	filter: HighwayFilter = defaultHighwayFilter,
	defaultSpeeds: DefaultSpeeds = DEFAULT_SPEEDS,
): RoutingGraph {
	const edges = new Map<number, GraphEdge[]>()
	const routable = new Set<number>()
	const intersections = new Set<number>()

	const addEdgeToNode = (from: number, edge: GraphEdge) => {
		let nodeEdges = edges.get(from)
		if (!nodeEdges) {
			nodeEdges = []
			edges.set(from, nodeEdges)
		}
		nodeEdges.push(edge)
	}

	for (let wayIndex = 0; wayIndex < osm.ways.size; wayIndex++) {
		const tags = osm.ways.tags.getTags(wayIndex)
		if (!filter(tags)) continue

		const refs = osm.ways.getRefIds(wayIndex)
		const nodes = refs.map((ref) => osm.nodes.ids.getIndexFromId(ref))
		if (nodes.length < 2) continue

		// Create bidirectional edges between consecutive nodes (respecting one-way)
		const oneway = tags?.["oneway"] === "yes" || tags?.["oneway"] === "1"
		const speed = getSpeedLimit(tags, defaultSpeeds)

		for (let i = 0; i < nodes.length - 1; i++) {
			const nodeIndex = nodes[i]!
			const targetNodeIndex = nodes[i + 1]!
			const fromCoord = osm.nodes.getNodeLonLat({ index: nodeIndex })
			const targetCoord = osm.nodes.getNodeLonLat({ index: targetNodeIndex })

			const distance = haversineDistance(fromCoord, targetCoord)
			const time = calculateTime(distance, speed)

			// Forward edge
			addEdgeToNode(nodeIndex, {
				targetNodeIndex: targetNodeIndex,
				wayIndex,
				distance,
				time,
			})

			// Reverse edge (unless one-way)
			if (!oneway) {
				addEdgeToNode(targetNodeIndex, {
					targetNodeIndex: nodeIndex,
					wayIndex,
					distance,
					time,
				})
			}

			// Track routable nodes and intersections (nodes appearing in multiple ways)
			if (routable.has(nodeIndex)) intersections.add(nodeIndex)
			else routable.add(nodeIndex)

			if (routable.has(targetNodeIndex)) intersections.add(targetNodeIndex)
			else routable.add(targetNodeIndex)
		}
	}

	return {
		edges,
		intersections,
		isRouteable: (nodeIndex) => routable.has(nodeIndex),
		isIntersection: (nodeIndex) => intersections.has(nodeIndex),
		getEdges: (nodeIndex) => edges.get(nodeIndex) ?? [],
	}
}

/**
 * Find the nearest routable OSM node from a geographic point.
 *
 * Searches for nodes within the given radius that are part of the routing
 * graph (i.e., lie on a routable way). Returns the closest match with its
 * coordinates and distance.
 *
 * @param osm - The OSM dataset.
 * @param graph - The routing graph built from the OSM data.
 * @param point - The [lon, lat] coordinates to search from.
 * @param maxKm - Maximum search radius in kilometers.
 * @returns The nearest routable node, or null if none found.
 *
 * @example
 * ```ts
 * const nearest = findNearestNodeOnGraph(osm, graph, [-73.989, 40.733], 0.5)
 * if (nearest) {
 *   console.log(`Found node ${nearest.nodeIndex} at ${nearest.distance}km`)
 * }
 * ```
 */
export function findNearestNodeOnGraph(
	osm: Osm,
	graph: RoutingGraph,
	point: LonLat,
	maxKm: number,
) {
	const nearby = osm.nodes.findIndexesWithinRadius(point[0], point[1], maxKm)

	let best: {
		nodeIndex: number
		coordinates: LonLat
		distance: number
	} | null = null
	let bestDist = Number.POSITIVE_INFINITY

	for (const nodeIndex of nearby) {
		if (!graph.isRouteable(nodeIndex)) continue

		const nodeCoord = osm.nodes.getNodeLonLat({ index: nodeIndex })
		const dist = haversineDistance(point, nodeCoord) / 1000
		if (dist < bestDist && dist <= maxKm) {
			bestDist = dist
			best = { nodeIndex, coordinates: nodeCoord, distance: dist }
		}
	}

	return best
}
