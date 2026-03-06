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

import type { RoutingAlgorithm, RoutingAlgorithmFn } from "../types.ts"
import { bidirectional } from "./bidirectional.ts"
import { astar, dijkstra } from "./shortest-path.ts"

export { astar, bidirectional, dijkstra }
export type { RoutingAlgorithmFn }

export const routingAlgorithms: Record<RoutingAlgorithm, RoutingAlgorithmFn> = {
	dijkstra,
	astar,
	bidirectional,
}
