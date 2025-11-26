import { haversineDistance } from "@osmix/shared/haversine-distance"
import { BinaryHeap } from "../binary-heap"
import type { GraphEdge, PathSegment, RoutingAlgorithmFn } from "../types"

/**
 * Maximum speed (m/s) for time-based heuristic.
 * Uses 130 km/h (~36.1 m/s) to ensure admissibility on all road types.
 */
const MAX_SPEED_MS = (130 * 1000) / 3600

/**
 * A* shortest path algorithm with configurable heuristic.
 *
 * When heuristic returns 0 for all nodes, this is equivalent to Dijkstra's algorithm.
 * With an admissible heuristic (never overestimates), guarantees optimal paths.
 */
function shortestPath(
	graph: (nodeIndex: number) => GraphEdge[],
	start: number,
	end: number,
	getWeight: (edge: GraphEdge) => number,
	heuristic: (nodeIndex: number) => number,
): PathSegment[] | null {
	// Same node - trivial path
	if (start === end) return [{ nodeIndex: start, cost: 0 }]

	const gScore = new Map<number, number>() // Best known cost to reach node
	const previous = new Map<number, PathSegment>() // How we reached each node
	const closed = new Set<number>() // Fully processed nodes
	const heap = new BinaryHeap()

	gScore.set(start, 0)
	heap.push(start, heuristic(start))

	while (heap.size > 0) {
		const current = heap.pop()!

		// Reached destination
		if (current === end) return reconstructPath(previous, start, end)

		// Already seen this node
		if (closed.has(current)) continue
		closed.add(current)

		const currentG = gScore.get(current)!

		for (const edge of graph(current)) {
			const neighbor = edge.targetNodeIndex

			if (closed.has(neighbor)) continue

			const tentativeG = currentG + getWeight(edge)
			const existingG = gScore.get(neighbor)

			if (existingG === undefined || tentativeG < existingG) {
				gScore.set(neighbor, tentativeG)
				previous.set(neighbor, {
					nodeIndex: neighbor,
					wayIndex: edge.wayIndex,
					previousNodeIndex: current,
					cost: tentativeG,
				})

				const f = tentativeG + heuristic(neighbor)
				heap.push(neighbor, f)
			}
		}
	}

	return null
}

/**
 * Reconstruct path from predecessor map.
 */
function reconstructPath(
	previous: Map<number, PathSegment>,
	start: number,
	end: number,
): PathSegment[] {
	const path: PathSegment[] = []
	let current: number | undefined = end

	while (current !== undefined) {
		const segment = previous.get(current)
		if (!segment) {
			path.unshift({ nodeIndex: current, cost: 0 })
			break
		}
		path.unshift(segment)
		current = segment.previousNodeIndex
	}

	if (path.length === 0 || path[0]?.nodeIndex !== start) {
		path.unshift({ nodeIndex: start, cost: 0 })
	}

	return path
}

/**
 * Dijkstra's algorithm - optimal shortest path without heuristic guidance.
 * Explores nodes in order of increasing distance from start.
 */
export const dijkstra: RoutingAlgorithmFn = (graph, start, end, getWeight) => {
	return shortestPath(graph, start, end, getWeight, () => 0)
}

/**
 * A* algorithm - uses heuristic to guide search toward destination.
 * Typically faster than Dijkstra for point-to-point queries.
 *
 * The heuristic is adapted based on the metric:
 * - distance: haversine distance in meters
 * - time: haversine distance / max speed (lower bound on travel time in seconds)
 */
export const astar: RoutingAlgorithmFn = (
	graph,
	start,
	end,
	getWeight,
	getCoord,
	metric,
) => {
	if (!getCoord) return null

	const endCoord = getCoord(end)
	if (!endCoord) return null

	// Haversine heuristic scaled by metric
	// For time: divide by max speed to get admissible time estimate
	const heuristic = (nodeIndex: number): number => {
		const coord = getCoord(nodeIndex)
		if (!coord) return 0
		const distance = haversineDistance(endCoord, coord)
		return metric === "time" ? distance / MAX_SPEED_MS : distance
	}

	return shortestPath(graph, start, end, getWeight, heuristic)
}
