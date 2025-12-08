import { beforeAll, describe, expect, it } from "bun:test"
import { Osm } from "@osmix/core"
import { getFixtureFile, PBFs } from "@osmix/shared/test/fixtures"
import { fromPbf } from "osmix"
import { buildGraph, getTransferableBuffers, RoutingGraph } from "../src"
import { Router } from "../src/router"

/**
 * Create a simple OSM with a routeable network
 */
function createTestOsm(): Osm {
	const osm = new Osm({ id: "test" })

	// Create a simple grid network
	// Nodes: 4 corners of a square
	osm.nodes.addNode({ id: 1, lat: 0, lon: 0 })
	osm.nodes.addNode({ id: 2, lat: 0, lon: 0.01 })
	osm.nodes.addNode({ id: 3, lat: 0.01, lon: 0 })
	osm.nodes.addNode({ id: 4, lat: 0.01, lon: 0.01 })
	// Center intersection node
	osm.nodes.addNode({ id: 5, lat: 0.005, lon: 0.005 })

	osm.nodes.buildIndex()
	osm.nodes.buildSpatialIndex()

	// Create ways connecting the nodes
	// Way 1: horizontal bottom (1 -> 2)
	osm.ways.addWay({
		id: 1,
		refs: [1, 2],
		tags: { highway: "primary" },
	})

	// Way 2: vertical left (1 -> 3)
	osm.ways.addWay({
		id: 2,
		refs: [1, 3],
		tags: { highway: "primary" },
	})

	// Way 3: horizontal top (3 -> 4)
	osm.ways.addWay({
		id: 3,
		refs: [3, 4],
		tags: { highway: "primary" },
	})

	// Way 4: vertical right (2 -> 4)
	osm.ways.addWay({
		id: 4,
		refs: [2, 4],
		tags: { highway: "primary" },
	})

	// Way 5: diagonal through center (1 -> 5 -> 4)
	osm.ways.addWay({
		id: 5,
		refs: [1, 5, 4],
		tags: { highway: "secondary" },
	})

	osm.ways.buildIndex()
	osm.ways.buildSpatialIndex()
	osm.buildIndexes()

	return osm
}

describe("Router", () => {
	it("should create a router with default config", () => {
		const osm = createTestOsm()
		const router = new Router(osm, buildGraph(osm))

		expect(router).toBeDefined()
	})

	it("should create a router with custom highway filter", () => {
		const osm = createTestOsm()
		const graph = buildGraph(osm, (tags) => tags?.["highway"] === "primary")
		const router = new Router(osm, graph)

		expect(router).toBeDefined()
	})

	it("should find a route between two nearby nodes", () => {
		const osm = createTestOsm()
		const graph = buildGraph(osm)
		const router = new Router(osm, graph)

		// Snap coordinates to nodes
		const from = graph.findNearestRoutableNode(osm, [0, 0], 500)
		const to = graph.findNearestRoutableNode(osm, [0, 0.01], 500)

		expect(from).not.toBeNull()
		expect(to).not.toBeNull()

		// Route between node indexes
		const path = router.route(from!.nodeIndex, to!.nodeIndex)

		expect(path).not.toBeNull()
		expect(path!.length).toBeGreaterThan(0)
	})

	it("should return path segments with node and way info", () => {
		const osm = createTestOsm()
		const graph = buildGraph(osm)
		const router = new Router(osm, graph)

		const from = graph.findNearestRoutableNode(osm, [0, 0], 500)
		const to = graph.findNearestRoutableNode(osm, [0.01, 0.01], 500)

		const path = router.route(from!.nodeIndex, to!.nodeIndex)

		expect(path).not.toBeNull()
		if (path) {
			// Verify path segments have required fields
			for (const segment of path) {
				expect(typeof segment.nodeIndex).toBe("number")
				expect(typeof segment.cost).toBe("number")
			}

			// Build result to get coordinates
			const result = router.buildResult(path)
			expect(result.coordinates.length).toBeGreaterThan(0)
			expect(Array.isArray(result.wayIndexes)).toBe(true)
			expect(Array.isArray(result.nodeIndexes)).toBe(true)
		}
	})

	it("should return null for unreachable destinations", () => {
		const osm = new Osm({ id: "test" })
		osm.nodes.addNode({ id: 1, lat: 0, lon: 0 })
		osm.nodes.addNode({ id: 2, lat: 10, lon: 10 }) // Far away, no way connecting
		osm.nodes.buildIndex()
		osm.nodes.buildSpatialIndex()
		osm.buildIndexes()

		const graph = buildGraph(osm)

		// Can't snap because no routable ways
		const from = graph.findNearestRoutableNode(osm, [0, 0], 500)
		const to = graph.findNearestRoutableNode(osm, [10, 10], 500)

		expect(from).toBeNull()
		expect(to).toBeNull()
	})

	it("should filter ways based on highway filter", () => {
		const osm = createTestOsm()
		// Only include primary highways
		const graph = buildGraph(osm, (tags) => tags?.["highway"] === "primary")
		const router = new Router(osm, graph)

		const from = graph.findNearestRoutableNode(osm, [0, 0], 500)
		const to = graph.findNearestRoutableNode(osm, [0.01, 0.01], 500)

		const path = router.route(from!.nodeIndex, to!.nodeIndex)

		// Should find a route using only primary ways
		if (path) {
			const result = router.buildResult(path)
			// Way index 4 is the secondary highway (ID 5)
			expect(result.wayIndexes).not.toContain(4)
		}
	})

	it("should handle same start and end node", () => {
		const osm = createTestOsm()
		const graph = buildGraph(osm)
		const router = new Router(osm, graph)

		const from = graph.findNearestRoutableNode(osm, [0, 0], 500)

		const path = router.route(from!.nodeIndex, from!.nodeIndex)

		expect(path).not.toBeNull()
		expect(path!.length).toBe(1)
		expect(path![0]!.nodeIndex).toBe(from!.nodeIndex)
	})

	it("should use different algorithms", () => {
		const osm = createTestOsm()
		const graph = buildGraph(osm)
		const router = new Router(osm, graph)

		const from = graph.findNearestRoutableNode(osm, [0, 0], 500)
		const to = graph.findNearestRoutableNode(osm, [0.01, 0.01], 500)

		const path1 = router.route(from!.nodeIndex, to!.nodeIndex, {
			algorithm: "dijkstra",
		})
		const path2 = router.route(from!.nodeIndex, to!.nodeIndex, {
			algorithm: "astar",
		})
		const path3 = router.route(from!.nodeIndex, to!.nodeIndex, {
			algorithm: "bidirectional",
		})

		// All should find a path
		const paths = [path1, path2, path3].filter((p) => p !== null)
		expect(paths.length).toBe(3)

		// All paths should have segments
		for (const path of paths) {
			expect(path!.length).toBeGreaterThan(0)
		}
	})

	it("should support distance and time metrics", () => {
		const osm = createTestOsm()
		const graph = buildGraph(osm)
		const router = new Router(osm, graph)

		const from = graph.findNearestRoutableNode(osm, [0, 0], 500)
		const to = graph.findNearestRoutableNode(osm, [0.01, 0.01], 500)

		const path1 = router.route(from!.nodeIndex, to!.nodeIndex, {
			metric: "distance",
		})
		const path2 = router.route(from!.nodeIndex, to!.nodeIndex, {
			metric: "time",
		})

		// Both should find paths
		expect(path1).not.toBeNull()
		expect(path2).not.toBeNull()
	})
})

describe("Router with Monaco PBF", () => {
	const monacoPbf = PBFs["monaco"]!
	let monacoOsm: Osm

	beforeAll(async () => {
		const pbfData = await getFixtureFile(monacoPbf.url)
		monacoOsm = await fromPbf(pbfData)
	})

	it("should create a router from Monaco OSM data", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph)
		expect(router).toBeDefined()
		// 11,414 total edges in the graph (bidirectional edges counted separately)
		expect(graph.edges).toBe(11_414)
	})

	it("should find routes between points in Monaco", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph)

		// Use coordinates known to have routeable nodes nearby
		const from = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4229093, 43.7371175],
			500,
		)
		const to = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4259193, 43.7377731],
			500,
		)

		expect(from).not.toBeNull()
		expect(to).not.toBeNull()

		const path = router.route(from!.nodeIndex, to!.nodeIndex)

		expect(path).not.toBeNull()
		expect(path!.length).toBeGreaterThan(0)

		// Build result and verify coordinates
		const result = router.buildResult(path!)
		expect(result.coordinates.length).toBeGreaterThan(0)
		expect(result.wayIndexes.length).toBeGreaterThan(0)

		// Verify coordinates are in Monaco bbox
		for (const coord of result.coordinates) {
			expect(coord[0]).toBeGreaterThanOrEqual(7.4)
			expect(coord[0]).toBeLessThanOrEqual(7.45)
			expect(coord[1]).toBeGreaterThanOrEqual(43.72)
			expect(coord[1]).toBeLessThanOrEqual(43.76)
		}
	})

	it("should return routes with valid way indexes from Monaco", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph)

		const from = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4229093, 43.7371175],
			500,
		)
		const to = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4259193, 43.7377731],
			500,
		)

		const path = router.route(from!.nodeIndex, to!.nodeIndex)

		if (path) {
			const result = router.buildResult(path)
			// Verify way indexes are valid
			for (const wayIndex of result.wayIndexes) {
				const way = monacoOsm.ways.getByIndex(wayIndex)
				expect(way).not.toBeNull()
				expect(way?.tags?.["highway"]).toBeDefined()
			}
		}
	})

	it("should find routes using different algorithms in Monaco", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph)

		const from = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4229093, 43.7371175],
			500,
		)
		const to = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4259193, 43.7377731],
			500,
		)

		const dijkstraPath = router.route(from!.nodeIndex, to!.nodeIndex, {
			algorithm: "dijkstra",
		})
		const astarPath = router.route(from!.nodeIndex, to!.nodeIndex, {
			algorithm: "astar",
		})
		const bidirectionalPath = router.route(from!.nodeIndex, to!.nodeIndex, {
			algorithm: "bidirectional",
		})

		// All should find paths
		const paths = [dijkstraPath, astarPath, bidirectionalPath].filter(
			(p) => p !== null,
		)
		expect(paths.length).toBe(3)

		// All paths should have segments
		for (const path of paths) {
			expect(path!.length).toBeGreaterThan(0)
		}
	})

	it("should handle time-based routing in Monaco", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph)

		const from = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4229093, 43.7371175],
			500,
		)
		const to = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4259193, 43.7377731],
			500,
		)

		const path = router.route(from!.nodeIndex, to!.nodeIndex, {
			metric: "time",
		})

		expect(path).not.toBeNull()
		expect(path!.length).toBeGreaterThan(0)
	})

	it("should return null when snap fails", () => {
		const graph = buildGraph(monacoOsm)

		// Point far outside Monaco
		const farPoint = graph.findNearestRoutableNode(monacoOsm, [10.0, 50.0], 100)
		expect(farPoint).toBeNull()
	})

	it("should calculate route statistics with getRouteStatistics()", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph)

		const from = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4229093, 43.7371175],
			500,
		)
		const to = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4259193, 43.7377731],
			500,
		)

		const path = router.route(from!.nodeIndex, to!.nodeIndex)
		expect(path).not.toBeNull()

		const stats = router.getRouteStatistics(path!)

		// Should have positive distance and time
		expect(stats.distance).toBeGreaterThan(0)
		expect(stats.time).toBeGreaterThan(0)

		// Distance should be reasonable for Monaco (< 10km)
		expect(stats.distance).toBeLessThan(10_000)
	})

	it("should build path info with getRoutePathInfo()", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph)

		const from = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4229093, 43.7371175],
			500,
		)
		const to = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4259193, 43.7377731],
			500,
		)

		const path = router.route(from!.nodeIndex, to!.nodeIndex)
		expect(path).not.toBeNull()

		const pathInfo = router.getRoutePathInfo(path!)

		// Should have at least one segment
		expect(pathInfo.segments.length).toBeGreaterThan(0)

		// Each segment should have required fields
		for (const segment of pathInfo.segments) {
			expect(Array.isArray(segment.wayIds)).toBe(true)
			expect(segment.wayIds.length).toBeGreaterThan(0)
			expect(typeof segment.name).toBe("string")
			expect(typeof segment.highway).toBe("string")
			expect(segment.distance).toBeGreaterThan(0)
			expect(segment.time).toBeGreaterThan(0)
		}

		// Turn points should be coordinates
		for (const turnPoint of pathInfo.turnPoints) {
			expect(Array.isArray(turnPoint)).toBe(true)
			expect(turnPoint.length).toBe(2)
			expect(typeof turnPoint[0]).toBe("number")
			expect(typeof turnPoint[1]).toBe("number")
		}
	})

	it("should include stats in buildResult() when includeStats is true", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph)

		const from = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4229093, 43.7371175],
			500,
		)
		const to = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4259193, 43.7377731],
			500,
		)

		const path = router.route(from!.nodeIndex, to!.nodeIndex)
		expect(path).not.toBeNull()

		// Without options - no stats
		const resultWithoutStats = router.buildResult(path!)
		expect(resultWithoutStats.distance).toBeUndefined()
		expect(resultWithoutStats.time).toBeUndefined()

		// With includeStats: true
		const resultWithStats = router.buildResult(path!, { includeStats: true })
		expect(resultWithStats.distance).toBeGreaterThan(0)
		expect(resultWithStats.time).toBeGreaterThan(0)
	})

	it("should include path info in buildResult() when includePathInfo is true", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph)

		const from = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4229093, 43.7371175],
			500,
		)
		const to = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4259193, 43.7377731],
			500,
		)

		const path = router.route(from!.nodeIndex, to!.nodeIndex)
		expect(path).not.toBeNull()

		// Without options - no path info
		const resultWithoutPathInfo = router.buildResult(path!)
		expect(resultWithoutPathInfo.segments).toBeUndefined()
		expect(resultWithoutPathInfo.turnPoints).toBeUndefined()

		// With includePathInfo: true
		const resultWithPathInfo = router.buildResult(path!, {
			includePathInfo: true,
		})
		expect(resultWithPathInfo.segments).toBeDefined()
		expect(resultWithPathInfo.segments!.length).toBeGreaterThan(0)
		expect(resultWithPathInfo.turnPoints).toBeDefined()
	})

	it("should include both stats and path info when both options are true", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph)

		const from = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4229093, 43.7371175],
			500,
		)
		const to = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4259193, 43.7377731],
			500,
		)

		const path = router.route(from!.nodeIndex, to!.nodeIndex)
		expect(path).not.toBeNull()

		const result = router.buildResult(path!, {
			includeStats: true,
			includePathInfo: true,
		})

		// Should have coordinates (always present)
		expect(result.coordinates.length).toBeGreaterThan(0)

		// Should have stats
		expect(result.distance).toBeGreaterThan(0)
		expect(result.time).toBeGreaterThan(0)

		// Should have path info
		expect(result.segments).toBeDefined()
		expect(result.segments!.length).toBeGreaterThan(0)
		expect(result.turnPoints).toBeDefined()

		// Verify segment totals roughly match stats
		const segmentDistanceSum = result.segments!.reduce(
			(sum, seg) => sum + seg.distance,
			0,
		)
		const segmentTimeSum = result.segments!.reduce(
			(sum, seg) => sum + seg.time,
			0,
		)

		expect(segmentDistanceSum).toBeCloseTo(result.distance!, 1)
		expect(segmentTimeSum).toBeCloseTo(result.time!, 1)
	})

	it("should use default options from constructor", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph, {
			includeStats: true,
			includePathInfo: true,
		})

		const from = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4229093, 43.7371175],
			500,
		)
		const to = graph.findNearestRoutableNode(
			monacoOsm,
			[7.4259193, 43.7377731],
			500,
		)

		const path = router.route(from!.nodeIndex, to!.nodeIndex)
		expect(path).not.toBeNull()

		// buildResult without options should use constructor defaults
		const result = router.buildResult(path!)

		expect(result.distance).toBeGreaterThan(0)
		expect(result.time).toBeGreaterThan(0)
		expect(result.segments).toBeDefined()
		expect(result.turnPoints).toBeDefined()
	})
})

describe("RoutingGraph Serialization", () => {
	it("should serialize and reconstruct graph correctly", () => {
		const osm = new Osm({ id: "test" })

		// Create a simple network
		osm.nodes.addNode({ id: 1, lat: 0, lon: 0 })
		osm.nodes.addNode({ id: 2, lat: 0, lon: 0.01 })
		osm.nodes.addNode({ id: 3, lat: 0.01, lon: 0.01 })
		osm.nodes.buildIndex()
		osm.nodes.buildSpatialIndex()

		osm.ways.addWay({
			id: 1,
			refs: [1, 2, 3],
			tags: { highway: "primary" },
		})
		osm.ways.buildIndex()
		osm.ways.buildSpatialIndex()
		osm.buildIndexes()

		// Build and compact the graph
		const originalGraph = buildGraph(osm)

		// Get transferables
		const transferables = originalGraph.transferables()

		// Verify transferables structure
		expect(transferables.nodeCount).toBe(osm.nodes.size)
		expect(transferables.edgeCount).toBe(originalGraph.edges)
		// Buffers can be either ArrayBuffer or SharedArrayBuffer depending on runtime
		const isBuffer = (b: unknown) =>
			b instanceof ArrayBuffer || b instanceof SharedArrayBuffer
		expect(isBuffer(transferables.edgeOffsets)).toBe(true)
		expect(isBuffer(transferables.edgeTargets)).toBe(true)
		expect(isBuffer(transferables.edgeDistances)).toBe(true)
		expect(isBuffer(transferables.edgeTimes)).toBe(true)
		expect(isBuffer(transferables.routableBits)).toBe(true)
		expect(isBuffer(transferables.intersectionBits)).toBe(true)

		// Reconstruct graph from transferables
		const reconstructedGraph = new RoutingGraph(transferables)

		// Verify properties match
		expect(reconstructedGraph.size).toBe(originalGraph.size)
		expect(reconstructedGraph.edges).toBe(originalGraph.edges)

		// Verify edges for each node match
		for (let i = 0; i < osm.nodes.size; i++) {
			const origEdges = originalGraph.getEdges(i)
			const reconEdges = reconstructedGraph.getEdges(i)
			expect(reconEdges.length).toBe(origEdges.length)

			for (let j = 0; j < origEdges.length; j++) {
				expect(reconEdges[j]!.targetNodeIndex).toBe(
					origEdges[j]!.targetNodeIndex,
				)
				expect(reconEdges[j]!.wayIndex).toBe(origEdges[j]!.wayIndex)
				expect(reconEdges[j]!.distance).toBeCloseTo(origEdges[j]!.distance, 2)
				expect(reconEdges[j]!.time).toBeCloseTo(origEdges[j]!.time, 2)
			}
		}

		// Verify routable and intersection flags
		expect(reconstructedGraph.isRoutable(0)).toBe(originalGraph.isRoutable(0))
		expect(reconstructedGraph.isRoutable(1)).toBe(originalGraph.isRoutable(1))
		expect(reconstructedGraph.isRoutable(2)).toBe(originalGraph.isRoutable(2))
		expect(reconstructedGraph.isIntersection(0)).toBe(
			originalGraph.isIntersection(0),
		)
		expect(reconstructedGraph.isIntersection(1)).toBe(
			originalGraph.isIntersection(1),
		)
	})

	it("should produce working router after reconstruction", () => {
		const osm = new Osm({ id: "test" })

		osm.nodes.addNode({ id: 1, lat: 0, lon: 0 })
		osm.nodes.addNode({ id: 2, lat: 0, lon: 0.01 })
		osm.nodes.addNode({ id: 3, lat: 0.01, lon: 0.01 })
		osm.nodes.buildIndex()
		osm.nodes.buildSpatialIndex()

		osm.ways.addWay({
			id: 1,
			refs: [1, 2, 3],
			tags: { highway: "primary" },
		})
		osm.ways.buildIndex()
		osm.ways.buildSpatialIndex()
		osm.buildIndexes()

		const originalGraph = buildGraph(osm)
		const transferables = originalGraph.transferables()
		const reconstructedGraph = new RoutingGraph(transferables)

		// Create routers with both graphs
		const router1 = new Router(osm, originalGraph)
		const router2 = new Router(osm, reconstructedGraph)

		// Both should find the same route
		const path1 = router1.route(0, 2)
		const path2 = router2.route(0, 2)

		expect(path1).not.toBeNull()
		expect(path2).not.toBeNull()
		expect(path1!.length).toBe(path2!.length)

		for (let i = 0; i < path1!.length; i++) {
			expect(path1![i]!.nodeIndex).toBe(path2![i]!.nodeIndex)
		}
	})

	it("should provide transferable buffers for postMessage", () => {
		const osm = new Osm({ id: "test" })
		osm.nodes.addNode({ id: 1, lat: 0, lon: 0 })
		osm.nodes.addNode({ id: 2, lat: 0, lon: 0.01 })
		osm.nodes.buildIndex()
		osm.nodes.buildSpatialIndex()
		osm.ways.addWay({
			id: 1,
			refs: [1, 2],
			tags: { highway: "primary" },
		})
		osm.ways.buildIndex()
		osm.ways.buildSpatialIndex()
		osm.buildIndexes()

		const graph = buildGraph(osm)
		const transferables = graph.transferables()
		const buffers = getTransferableBuffers(transferables)

		// When SharedArrayBuffer is available, returns empty (they're shared, not transferred).
		// When only ArrayBuffer is available, returns all 7 buffers.
		const usesSharedArrayBuffer =
			typeof SharedArrayBuffer !== "undefined" &&
			transferables.edgeOffsets instanceof SharedArrayBuffer
		if (usesSharedArrayBuffer) {
			expect(buffers.length).toBe(0)
		} else {
			expect(buffers.length).toBe(7)
			for (const buffer of buffers) {
				expect(buffer).toBeInstanceOf(ArrayBuffer)
			}
		}
	})
})
