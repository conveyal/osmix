/**
 * Routing algorithm implementations.
 *
 * Provides three algorithms:
 * - `dijkstra`: Optimal shortest path, explores all directions equally.
 * - `astar`: Optimal with heuristic guidance, faster for point-to-point.
 * - `bidirectional`: Fast BFS from both ends, finds *a* path (not always optimal).
 *
 * @module
 */

import type { RoutingAlgorithm, RoutingAlgorithmFn } from "../types"
import { bidirectional } from "./bidirectional"
import { astar, dijkstra } from "./shortest-path"

export { astar, bidirectional, dijkstra }
export type { RoutingAlgorithmFn }

export const routingAlgorithms: Record<RoutingAlgorithm, RoutingAlgorithmFn> = {
	dijkstra,
	astar,
	bidirectional,
}
