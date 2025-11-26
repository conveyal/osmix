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
 * Graph built from OSM ways and nodes.
 *
 * Construction by collecting routable ways and track which nodes they contain, then
 * creating bidirectional edges between consecutive nodes (respecting one-way).
 *
 * Edges store pre-computed distance and time for fast weight lookups.
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

			// If nodes have been seen in other ways, add to intersection list
			if (routable.has(nodeIndex)) intersections.add(nodeIndex)
			else routable.add(nodeIndex)
		}
	}

	return {
		edges,
		intersections,
		isRouteable: (nodeIndex) => edges.has(nodeIndex),
		isIntersection: (nodeIndex) => intersections.has(nodeIndex),
		getEdges: (nodeIndex) => edges.get(nodeIndex) ?? [],
	}
}

/**
 * Find the nearest routeable OSM node from a point within a given radius
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
