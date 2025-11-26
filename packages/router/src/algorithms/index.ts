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
