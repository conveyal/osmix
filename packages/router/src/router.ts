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
import type {
	PathSegment,
	RouteOptions,
	RoutePathInfo,
	RouteResult,
	RouteStatistics,
	WaySegment,
} from "./types"

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
			includeStats: options.includeStats ?? false,
			includePathInfo: options.includePathInfo ?? false,
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
	buildResult(
		path: PathSegment[],
		options: Partial<RouteOptions> = {},
	): RouteResult {
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

		const result: RouteResult = { coordinates, wayIndexes, nodeIndexes }

		const includeStats = options.includeStats ?? this.defaults.includeStats
		const includePathInfo =
			options.includePathInfo ?? this.defaults.includePathInfo

		if (includeStats) {
			const stats = this.getRouteStatistics(path)
			result.distance = stats.distance
			result.time = stats.time
		}

		if (includePathInfo) {
			const pathInfo = this.getRoutePathInfo(path)
			result.segments = pathInfo.segments
			result.turnPoints = pathInfo.turnPoints
		}

		return result
	}

	/**
	 * Calculate route statistics (distance and time) from path segments.
	 * @param path - Path segments from route().
	 * @returns Total distance in meters and time in seconds.
	 */
	getRouteStatistics(path: PathSegment[]): RouteStatistics {
		let distance = 0
		let time = 0

		for (const seg of path) {
			if (seg.wayIndex !== undefined && seg.previousNodeIndex !== undefined) {
				const edges = this.graph.getEdges(seg.previousNodeIndex)
				const edge = edges.find(
					(e) =>
						e.targetNodeIndex === seg.nodeIndex && e.wayIndex === seg.wayIndex,
				)
				if (edge) {
					distance += edge.distance
					time += edge.time
				}
			}
		}

		return { distance, time }
	}

	/**
	 * Build route path info (segments and turn points) from path segments.
	 * Consecutive ways with the same name are merged into a single segment.
	 * @param path - Path segments from route().
	 * @returns Segments with per-way breakdown and turn point coordinates.
	 */
	getRoutePathInfo(path: PathSegment[]): RoutePathInfo {
		// First, collect edge traversals with way info
		interface EdgeTraversal {
			wayIndex: number
			transitionNodeIndex: number
			distance: number
			time: number
		}
		const edgeSequence: EdgeTraversal[] = []

		for (const seg of path) {
			if (seg.wayIndex !== undefined && seg.previousNodeIndex !== undefined) {
				const edges = this.graph.getEdges(seg.previousNodeIndex)
				const edge = edges.find(
					(e) =>
						e.targetNodeIndex === seg.nodeIndex && e.wayIndex === seg.wayIndex,
				)
				if (edge) {
					edgeSequence.push({
						wayIndex: seg.wayIndex,
						transitionNodeIndex: seg.previousNodeIndex,
						distance: edge.distance,
						time: edge.time,
					})
				}
			}
		}

		// Build segments, merging consecutive same-name ways
		const segments: WaySegment[] = []
		const turnPoints: LonLat[] = []
		let currentSegment: WaySegment | null = null
		let currentDisplayName: string | null = null

		const getDisplayName = (tags?: Record<string, string | number>) => {
			const name = (tags?.["name"] as string) ?? ""
			const highway = (tags?.["highway"] as string) ?? ""
			return name || highway
		}

		for (const {
			wayIndex,
			transitionNodeIndex,
			distance,
			time,
		} of edgeSequence) {
			const wayId = this.osm.ways.ids.at(wayIndex)
			const tags = this.osm.ways.tags.getTags(wayIndex)
			const name = (tags?.["name"] as string) ?? ""
			const highway = (tags?.["highway"] as string) ?? ""
			const displayName = getDisplayName(tags)

			if (currentSegment && currentDisplayName === displayName) {
				if (!currentSegment.wayIds.includes(wayId)) {
					currentSegment.wayIds.push(wayId)
				}
				currentSegment.distance += distance
				currentSegment.time += time
			} else {
				if (currentSegment) {
					segments.push(currentSegment)
					const coord = this.osm.nodes.getNodeLonLat({
						index: transitionNodeIndex,
					})
					if (coord) {
						turnPoints.push(coord)
					}
				}
				currentSegment = {
					wayIds: [wayId],
					name,
					highway,
					distance,
					time,
				}
				currentDisplayName = displayName
			}
		}

		if (currentSegment) {
			segments.push(currentSegment)
		}

		return { segments, turnPoints }
	}
}
