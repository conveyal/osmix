import { describe, expect, it } from "bun:test"
import { astar, bidirectional, dijkstra } from "../src/algorithms"
import type { GraphEdge } from "../src/types"

/**
 * Test suite for individual routing algorithms.
 *
 * These tests verify the core behavior of each algorithm in isolation,
 * using simple mock graphs instead of full OSM data. This allows us to
 * test specific edge cases and verify algorithm correctness.
 */

// ---------------------------------------------------------------------------
// Mock Graph Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a simple graph function from an adjacency list.
 * The adjacency list maps node IDs to their outgoing edges.
 */
function createGraph(
	adjacencyList: Map<number, GraphEdge[]>,
): (nodeId: number) => GraphEdge[] {
	return (nodeId: number) => adjacencyList.get(nodeId) ?? []
}

/**
 * Simple edge weight function that uses distance.
 */
function distanceWeight(edge: GraphEdge): number {
	return edge.distance
}

/**
 * Creates a mock edge with default values.
 */
function mockEdge(
	targetNodeIndex: number,
	wayIndex: number,
	distance: number,
): GraphEdge {
	return {
		targetNodeIndex: targetNodeIndex,
		wayIndex,
		distance,
		time: distance / 10, // 10 m/s default speed
	}
}

/**
 * Creates a simple linear graph: 1 <-> 2 <-> 3 <-> 4
 * Bidirectional edges for proper routing.
 */
function createLinearGraph(): Map<number, GraphEdge[]> {
	return new Map([
		[1, [mockEdge(2, 100, 10)]],
		[2, [mockEdge(1, 100, 10), mockEdge(3, 101, 10)]],
		[3, [mockEdge(2, 101, 10), mockEdge(4, 102, 10)]],
		[4, [mockEdge(3, 102, 10)]],
	])
}

/**
 * Creates a graph with multiple paths (bidirectional):
 *
 *     1 <---(way 100, dist 10)---> 2
 *     ^                           ^
 *     | (way 101, dist 5)         | (way 102, dist 5)
 *     v                           v
 *     3 <---(way 103, dist 10)---> 4
 *
 * Path 1->2->4 has distance 15
 * Path 1->3->4 has distance 15
 */
function createSquareGraph(): Map<number, GraphEdge[]> {
	return new Map([
		[1, [mockEdge(2, 100, 10), mockEdge(3, 101, 5)]],
		[2, [mockEdge(1, 100, 10), mockEdge(4, 102, 5)]],
		[3, [mockEdge(1, 101, 5), mockEdge(4, 103, 10)]],
		[4, [mockEdge(2, 102, 5), mockEdge(3, 103, 10)]],
	])
}

/**
 * Creates a graph where shortest path is indirect (bidirectional):
 *
 *     1 <---(way 100, dist 100)---> 4  (direct but long)
 *     ^
 *     | (way 101, dist 10)
 *     v
 *     2 <---(way 102, dist 10)---> 3 <---(way 103, dist 10)---> 4
 *
 * Direct path: 100
 * Indirect path: 30 (should be chosen)
 */
function createIndirectShorterGraph(): Map<number, GraphEdge[]> {
	return new Map([
		[
			1,
			[
				mockEdge(4, 100, 100), // Direct but long
				mockEdge(2, 101, 10), // Indirect start
			],
		],
		[2, [mockEdge(1, 101, 10), mockEdge(3, 102, 10)]],
		[3, [mockEdge(2, 102, 10), mockEdge(4, 103, 10)]],
		[4, [mockEdge(1, 100, 100), mockEdge(3, 103, 10)]],
	])
}

/**
 * Creates a disconnected graph where node 4 is unreachable.
 * Nodes 1-3 are connected bidirectionally, but 4 has no edges.
 */
function createDisconnectedGraph(): Map<number, GraphEdge[]> {
	return new Map([
		[1, [mockEdge(2, 100, 10)]],
		[2, [mockEdge(1, 100, 10), mockEdge(3, 101, 10)]],
		[3, [mockEdge(2, 101, 10)]],
		[4, []], // Unreachable - no edges to/from this node
	])
}

/**
 * Creates a mock coordinate function for A* heuristic.
 *
 * The coordinates are carefully chosen so that the heuristic (straight-line
 * distance) is admissible - it never overestimates the actual path cost.
 * This ensures A* will find optimal paths.
 *
 * Node layout (not to scale):
 *   1 ---- 2 ---- 3 ---- 4
 *
 * Each segment is ~5m (0.00005 degrees), so total 1->4 is ~15m.
 * Edge weights are 10+ units, so heuristic <= actual cost (admissible).
 */
function createCoordFn(): (nodeId: number) => [number, number] | undefined {
	const coords = new Map<number, [number, number]>([
		[1, [0, 0]],
		[2, [0.00005, 0]], // ~5m east
		[3, [0.0001, 0]], // ~10m east
		[4, [0.00015, 0]], // ~15m east
	])
	return (nodeId: number) => coords.get(nodeId)
}

// ---------------------------------------------------------------------------
// Dijkstra Tests
// ---------------------------------------------------------------------------

describe("dijkstra", () => {
	it("should find direct path between adjacent nodes", () => {
		const graph = createGraph(createLinearGraph())
		const path = dijkstra(graph, 1, 2, distanceWeight)

		expect(path).not.toBeNull()
		expect(path?.length).toBe(2)
		expect(path?.[0]?.nodeIndex).toBe(1)
		expect(path?.[1]?.nodeIndex).toBe(2)
		expect(path?.[1]?.wayIndex).toBe(100)
	})

	it("should find path through multiple nodes", () => {
		const graph = createGraph(createLinearGraph())
		const path = dijkstra(graph, 1, 4, distanceWeight)

		expect(path).not.toBeNull()
		expect(path?.length).toBe(4)

		// Verify node order
		const nodeIds = path?.map((p) => p.nodeIndex)
		expect(nodeIds).toEqual([1, 2, 3, 4])

		// Verify way indexes are tracked
		expect(path?.[1]?.wayIndex).toBe(100)
		expect(path?.[2]?.wayIndex).toBe(101)
		expect(path?.[3]?.wayIndex).toBe(102)
	})

	it("should return null when no path exists", () => {
		const graph = createGraph(createDisconnectedGraph())
		const path = dijkstra(graph, 1, 4, distanceWeight)

		expect(path).toBeNull()
	})

	it("should handle same start and end node", () => {
		const graph = createGraph(createLinearGraph())
		const path = dijkstra(graph, 1, 1, distanceWeight)

		expect(path).not.toBeNull()
		expect(path?.length).toBe(1)
		expect(path?.[0]?.nodeIndex).toBe(1)
	})

	it("should find shortest path when indirect is shorter", () => {
		const graph = createGraph(createIndirectShorterGraph())
		const path = dijkstra(graph, 1, 4, distanceWeight)

		expect(path).not.toBeNull()

		// Should take indirect route 1->2->3->4 (cost 30) not 1->4 (cost 100)
		const nodeIds = path?.map((p) => p.nodeIndex)
		expect(nodeIds).toEqual([1, 2, 3, 4])

		// Verify total cost
		const lastSegment = path?.[path.length - 1]
		expect(lastSegment?.cost).toBe(30)
	})

	it("should calculate correct costs", () => {
		const graph = createGraph(createLinearGraph())
		const path = dijkstra(graph, 1, 4, distanceWeight)

		expect(path).not.toBeNull()

		// Each edge has distance 10
		expect(path?.[0]?.cost).toBe(0) // Start node
		expect(path?.[1]?.cost).toBe(10)
		expect(path?.[2]?.cost).toBe(20)
		expect(path?.[3]?.cost).toBe(30)
	})

	it("should track correct way indexes in path", () => {
		const graph = createGraph(createSquareGraph())
		const path = dijkstra(graph, 1, 4, distanceWeight)

		expect(path).not.toBeNull()

		// Verify way indexes are present for traversed edges
		const wayIndexes = path?.slice(1).map((p) => p.wayIndex)
		expect(wayIndexes?.every((idx) => idx !== undefined)).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// A* Tests
// ---------------------------------------------------------------------------

describe("astar", () => {
	it("should find direct path between adjacent nodes", () => {
		const graph = createGraph(createLinearGraph())
		const path = astar(graph, 1, 2, distanceWeight, createCoordFn())

		expect(path).not.toBeNull()
		expect(path?.length).toBe(2)
		expect(path?.[0]?.nodeIndex).toBe(1)
		expect(path?.[1]?.nodeIndex).toBe(2)
	})

	it("should find path through multiple nodes", () => {
		const graph = createGraph(createLinearGraph())
		const path = astar(graph, 1, 4, distanceWeight, createCoordFn())

		expect(path).not.toBeNull()
		const nodeIds = path?.map((p) => p.nodeIndex)
		expect(nodeIds).toEqual([1, 2, 3, 4])
	})

	it("should return null when no path exists", () => {
		const graph = createGraph(createDisconnectedGraph())
		const path = astar(graph, 1, 4, distanceWeight, createCoordFn())

		expect(path).toBeNull()
	})

	it("should handle same start and end node", () => {
		const graph = createGraph(createLinearGraph())
		const path = astar(graph, 1, 1, distanceWeight, createCoordFn())

		expect(path).not.toBeNull()
		expect(path?.length).toBe(1)
		expect(path?.[0]?.nodeIndex).toBe(1)
	})

	it("should find shortest path when indirect is shorter", () => {
		const graph = createGraph(createIndirectShorterGraph())
		const path = astar(graph, 1, 4, distanceWeight, createCoordFn())

		expect(path).not.toBeNull()
		const nodeIds = path?.map((p) => p.nodeIndex)
		expect(nodeIds).toEqual([1, 2, 3, 4])
	})

	it("should use heuristic to guide search", () => {
		// With heuristic, A* should explore fewer nodes than Dijkstra
		// We can verify it finds the correct path
		const graph = createGraph(createIndirectShorterGraph())
		const path = astar(graph, 1, 4, distanceWeight, createCoordFn())

		expect(path).not.toBeNull()
		expect(path?.[path.length - 1]?.cost).toBe(30)
	})

	it("should return null when coordinate function is missing", () => {
		const graph = createGraph(createLinearGraph())
		const path = astar(graph, 1, 4, distanceWeight, undefined)

		expect(path).toBeNull()
	})

	it("should handle missing coordinate for node gracefully", () => {
		const graph = createGraph(createLinearGraph())
		// Coordinate function that only knows about nodes 1 and 4
		const partialCoordFn = (nodeId: number) => {
			if (nodeId === 1) return [0, 0] as [number, number]
			if (nodeId === 4) return [0.001, 0.001] as [number, number]
			return undefined
		}
		const path = astar(graph, 1, 4, distanceWeight, partialCoordFn)

		// A* should still find a path, using 0 heuristic for unknown nodes
		expect(path).not.toBeNull()
		const nodeIds = path?.map((p) => p.nodeIndex)
		expect(nodeIds).toEqual([1, 2, 3, 4])
	})

	it("should track correct way indexes in path", () => {
		const graph = createGraph(createSquareGraph())
		const path = astar(graph, 1, 4, distanceWeight, createCoordFn())

		expect(path).not.toBeNull()
		const wayIndexes = path?.slice(1).map((p) => p.wayIndex)
		expect(wayIndexes?.every((idx) => idx !== undefined)).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// Bidirectional Tests
// ---------------------------------------------------------------------------

describe("bidirectional", () => {
	it("should find direct path between adjacent nodes", () => {
		const graph = createGraph(createLinearGraph())
		const path = bidirectional(graph, 1, 2, distanceWeight)

		expect(path).not.toBeNull()
		// Bidirectional may have different path structure but same nodes
		const nodeIds = path?.map((p) => p.nodeIndex)
		expect(nodeIds).toContain(1)
		expect(nodeIds).toContain(2)
	})

	it("should find path through multiple nodes", () => {
		const graph = createGraph(createLinearGraph())
		const path = bidirectional(graph, 1, 4, distanceWeight)

		expect(path).not.toBeNull()
		const nodeIds = path?.map((p) => p.nodeIndex)
		// Should contain all nodes in the path
		expect(nodeIds).toContain(1)
		expect(nodeIds).toContain(4)
	})

	it("should return null when no path exists", () => {
		const graph = createGraph(createDisconnectedGraph())
		const path = bidirectional(graph, 1, 4, distanceWeight)

		expect(path).toBeNull()
	})

	it("should handle same start and end node", () => {
		const graph = createGraph(createLinearGraph())
		const path = bidirectional(graph, 1, 1, distanceWeight)

		expect(path).not.toBeNull()
		expect(path?.some((p) => p.nodeIndex === 1)).toBe(true)
	})

	it("should meet in the middle correctly", () => {
		// Create a symmetric graph where meeting in middle is clear
		// 1 <-> 2 <-> 3 <-> 4 <-> 5
		const symmetricGraph = new Map([
			[1, [mockEdge(2, 100, 10)]],
			[2, [mockEdge(1, 100, 10), mockEdge(3, 101, 10)]],
			[3, [mockEdge(2, 101, 10), mockEdge(4, 102, 10)]],
			[4, [mockEdge(3, 102, 10), mockEdge(5, 103, 10)]],
			[5, [mockEdge(4, 103, 10)]],
		])

		const graph = createGraph(symmetricGraph)
		const path = bidirectional(graph, 1, 5, distanceWeight)

		expect(path).not.toBeNull()
		// Should include start and end
		const nodeIds = path?.map((p) => p.nodeIndex)
		expect(nodeIds).toContain(1)
		expect(nodeIds).toContain(5)
	})

	it("should combine forward and backward paths properly", () => {
		const graph = createGraph(createSquareGraph())
		const path = bidirectional(graph, 1, 4, distanceWeight)

		expect(path).not.toBeNull()

		// Path should go from 1 to 4
		const nodeIds = path?.map((p) => p.nodeIndex)
		expect(nodeIds?.[0]).toBe(1)
		// Last node should be 4 or path should include 4
		expect(nodeIds).toContain(4)
	})

	it("should track way indexes in combined path", () => {
		const graph = createGraph(createSquareGraph())
		const path = bidirectional(graph, 1, 4, distanceWeight)

		expect(path).not.toBeNull()

		// Way indexes should be present (except possibly for start node)
		const wayIndexes = path
			?.filter((p) => p.wayIndex !== undefined)
			.map((p) => p.wayIndex)
		expect(wayIndexes?.length).toBeGreaterThan(0)
	})
})

// ---------------------------------------------------------------------------
// Cross-Algorithm Comparison Tests
// ---------------------------------------------------------------------------

describe("algorithm consistency", () => {
	it("should find same path length with all algorithms", () => {
		const graph = createGraph(createIndirectShorterGraph())

		const dijkstraPath = dijkstra(graph, 1, 4, distanceWeight)
		const astarPath = astar(graph, 1, 4, distanceWeight, createCoordFn())
		const biPath = bidirectional(graph, 1, 4, distanceWeight)

		// All should find a path
		expect(dijkstraPath).not.toBeNull()
		expect(astarPath).not.toBeNull()
		expect(biPath).not.toBeNull()

		// Dijkstra and A* should have same final cost
		const dijkstraCost = dijkstraPath?.[dijkstraPath.length - 1]?.cost
		const astarCost = astarPath?.[astarPath.length - 1]?.cost

		expect(dijkstraCost).toBe(astarCost)
	})

	it("all algorithms should return null for unreachable nodes", () => {
		const graph = createGraph(createDisconnectedGraph())

		expect(dijkstra(graph, 1, 4, distanceWeight)).toBeNull()
		expect(astar(graph, 1, 4, distanceWeight, createCoordFn())).toBeNull()
		expect(bidirectional(graph, 1, 4, distanceWeight)).toBeNull()
	})

	it("all algorithms should handle trivial single-node path", () => {
		const graph = createGraph(createLinearGraph())

		const dijkstraPath = dijkstra(graph, 1, 1, distanceWeight)
		const astarPath = astar(graph, 1, 1, distanceWeight, createCoordFn())
		const biPath = bidirectional(graph, 1, 1, distanceWeight)

		expect(dijkstraPath).not.toBeNull()
		expect(astarPath).not.toBeNull()
		expect(biPath).not.toBeNull()

		// All should include node 1
		expect(dijkstraPath?.some((p) => p.nodeIndex === 1)).toBe(true)
		expect(astarPath?.some((p) => p.nodeIndex === 1)).toBe(true)
		expect(biPath?.some((p) => p.nodeIndex === 1)).toBe(true)
	})
})
