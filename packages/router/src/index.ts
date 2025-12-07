/**
 * @osmix/router - Pathfinding on OSM road networks.
 *
 * Builds a routeable graph from OSM ways and provides pathfinding algorithms
 * (Dijkstra, A*, bidirectional) for finding routes between nodes. Supports
 * both distance and time-based routing.
 *
 * Key features:
 * - **Graph construction**: Build routing graphs from OSM ways with highway filtering.
 * - **Multiple algorithms**: Dijkstra, A*, and bidirectional search.
 * - **Time-based routing**: Uses maxspeed tags and default speeds by highway type.
 * - **One-way support**: Respects oneway=yes/1 tags.
 * - **Snapping**: Find nearest routable node from arbitrary coordinates.
 *
 * @example
 * ```ts
 * import { buildGraph, Router, findNearestNodeOnGraph } from "@osmix/router"
 *
 * const graph = buildGraph(osm)
 * const router = new Router(osm, graph)
 *
 * const start = findNearestNodeOnGraph(osm, graph, [-73.989, 40.733], 1)
 * const end = findNearestNodeOnGraph(osm, graph, [-73.988, 40.734], 1)
 *
 * if (start && end) {
 *   const path = router.route(start.nodeIndex, end.nodeIndex)
 *   if (path) {
 *     const result = router.buildResult(path)
 *     console.log(result.coordinates)
 *   }
 * }
 * ```
 *
 * @module @osmix/router
 */

export * from "./algorithms"
export * from "./graph"
export * from "./router"
export * from "./types"
export * from "./utils"
