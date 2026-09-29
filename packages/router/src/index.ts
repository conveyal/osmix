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
 * - **One-way support**: Respects explicit one-way tags and implicit roundabout direction.
 * - **Snapping**: Find nearest routable node from arbitrary coordinates.
 *
 * Not modeled: turn restrictions, access tags, `oneway:*` per-mode overrides,
 * conditional restrictions, turn costs and elevation. See the README "Limitations".
 *
 * @example
 * ```ts
 * import { buildGraph, Router } from "@osmix/router"
 *
 * const graph = buildGraph(osm)
 * const router = new Router(osm, graph)
 *
 * // Snap radius is in meters. Needs the "all" node spatial index.
 * const start = graph.findNearestRoutableNode(osm, [-73.989, 40.733], 500)
 * const end = graph.findNearestRoutableNode(osm, [-73.988, 40.734], 500)
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

export * from "./algorithms/index.ts";
export * from "./graph.ts";
export * from "./router.ts";
export * from "./topology-stats.ts";
export * from "./types.ts";
export * from "./utils.ts";
