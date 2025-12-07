/**
 * High-level router API.
 *
 * Wraps the routing graph and algorithms to provide a convenient interface
 * for finding routes and building result objects with coordinates.
 *
 * @module
 */

import type { Osm } from "@osmix/core"
import type { LonLat } from "@osmix/shared/types"
import { routingAlgorithms } from "./algorithms"
import type { RoutingGraph } from "./graph"
import type { PathSegment, RouteOptions, RouteResult } from "./types"

/**
 * Router for finding paths through OSM road networks.
 *
 * Uses pathfinding algorithms (Dijkstra, A*, or bidirectional) to find
 * routes between node indexes. Use `findNearestNodeOnGraph()` to snap
 * arbitrary coordinates to routable nodes before calling `route()`.
 *
 * @example
 * ```ts
 * const router = new Router(osm, graph, { algorithm: "astar" })
 * const path = router.route(startNodeIndex, endNodeIndex)
 * if (path) {
 *   const result = router.buildResult(path)
 *   console.log(result.coordinates)
 * }
 * ```
 */
export class Router {
	readonly graph: RoutingGraph
	readonly osm: Osm
	private readonly defaults: Required<RouteOptions>

	constructor(
		osm: Osm,
		graph: RoutingGraph,
		options: Partial<RouteOptions> = {},
	) {
		this.osm = osm
		this.graph = graph
		this.defaults = {
			algorithm: options.algorithm ?? "astar",
			metric: options.metric ?? "distance",
		}
	}

	/**
	 * Find a route between two node indexes.
	 * Returns path segments or null if no path exists.
	 */
	route(
		fromNodeIndex: number,
		toNodeIndex: number,
		options: Partial<RouteOptions> = {},
	): PathSegment[] | null {
		// Trivial case: same node
		if (fromNodeIndex === toNodeIndex)
			return [{ nodeIndex: fromNodeIndex, cost: 0 }]

		const algorithm =
			routingAlgorithms[options.algorithm ?? this.defaults.algorithm]
		const metric = options.metric ?? this.defaults.metric

		return algorithm(
			(nodeIndex) => this.graph.getEdges(nodeIndex),
			fromNodeIndex,
			toNodeIndex,
			(edge) => (metric === "distance" ? edge.distance : edge.time),
			(nodeIndex) => this.osm.nodes.getNodeLonLat({ index: nodeIndex }),
			metric,
		)
	}

	/** Build route result with coordinates from path segments. */
	buildResult(path: PathSegment[]): RouteResult {
		const coordinates: LonLat[] = []
		const wayIndexes: number[] = []
		const nodeIndexes: number[] = []
		const seenNodes = new Set<number>()

		let currentWay: number | undefined

		for (let i = 0; i < path.length; i++) {
			const seg = path[i]!
			const coord = this.osm.nodes.getNodeLonLat({ index: seg.nodeIndex })
			if (coord) coordinates.push(coord)

			// Track way transitions
			if (seg.wayIndex !== undefined && seg.wayIndex !== currentWay) {
				wayIndexes.push(seg.wayIndex)
				currentWay = seg.wayIndex
				// Mark node at way transition
				if (i > 0 && !seenNodes.has(seg.nodeIndex)) {
					seenNodes.add(seg.nodeIndex)
					nodeIndexes.push(seg.nodeIndex)
				}
			}

			// Mark start, end, and intersections
			const isEndpoint = i === 0 || i === path.length - 1
			const isIntersection = this.graph.isIntersection(seg.nodeIndex)
			if ((isEndpoint || isIntersection) && !seenNodes.has(seg.nodeIndex)) {
				seenNodes.add(seg.nodeIndex)
				nodeIndexes.push(seg.nodeIndex)
			}
		}

		return { coordinates, wayIndexes, nodeIndexes }
	}
}
