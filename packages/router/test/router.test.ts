import { beforeAll, describe, expect, it } from "bun:test"
import { Osm } from "@osmix/core"
import { getFixtureFile, PBFs } from "@osmix/shared/test/fixtures"
import { fromPbf } from "osmix"
import { buildGraph, findNearestNodeOnGraph } from "../src"
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
		const from = findNearestNodeOnGraph(osm, graph, [0, 0], 500)
		const to = findNearestNodeOnGraph(osm, graph, [0, 0.01], 500)

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

		const from = findNearestNodeOnGraph(osm, graph, [0, 0], 500)
		const to = findNearestNodeOnGraph(osm, graph, [0.01, 0.01], 500)

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
		const from = findNearestNodeOnGraph(osm, graph, [0, 0], 500)
		const to = findNearestNodeOnGraph(osm, graph, [10, 10], 500)

		expect(from).toBeNull()
		expect(to).toBeNull()
	})

	it("should filter ways based on highway filter", () => {
		const osm = createTestOsm()
		// Only include primary highways
		const graph = buildGraph(osm, (tags) => tags?.["highway"] === "primary")
		const router = new Router(osm, graph)

		const from = findNearestNodeOnGraph(osm, graph, [0, 0], 500)
		const to = findNearestNodeOnGraph(osm, graph, [0.01, 0.01], 500)

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

		const from = findNearestNodeOnGraph(osm, graph, [0, 0], 500)

		const path = router.route(from!.nodeIndex, from!.nodeIndex)

		expect(path).not.toBeNull()
		expect(path!.length).toBe(1)
		expect(path![0]!.nodeIndex).toBe(from!.nodeIndex)
	})

	it("should use different algorithms", () => {
		const osm = createTestOsm()
		const graph = buildGraph(osm)
		const router = new Router(osm, graph)

		const from = findNearestNodeOnGraph(osm, graph, [0, 0], 500)
		const to = findNearestNodeOnGraph(osm, graph, [0.01, 0.01], 500)

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

		const from = findNearestNodeOnGraph(osm, graph, [0, 0], 500)
		const to = findNearestNodeOnGraph(osm, graph, [0.01, 0.01], 500)

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
		expect(graph.edges.size).toBe(7_073)
	})

	it("should find routes between points in Monaco", () => {
		const graph = buildGraph(monacoOsm)
		const router = new Router(monacoOsm, graph)

		// Use coordinates known to have routeable nodes nearby
		const from = findNearestNodeOnGraph(
			monacoOsm,
			graph,
			[7.4229093, 43.7371175],
			500,
		)
		const to = findNearestNodeOnGraph(
			monacoOsm,
			graph,
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

		const from = findNearestNodeOnGraph(
			monacoOsm,
			graph,
			[7.4229093, 43.7371175],
			500,
		)
		const to = findNearestNodeOnGraph(
			monacoOsm,
			graph,
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

		const from = findNearestNodeOnGraph(
			monacoOsm,
			graph,
			[7.4229093, 43.7371175],
			500,
		)
		const to = findNearestNodeOnGraph(
			monacoOsm,
			graph,
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

		const from = findNearestNodeOnGraph(
			monacoOsm,
			graph,
			[7.4229093, 43.7371175],
			500,
		)
		const to = findNearestNodeOnGraph(
			monacoOsm,
			graph,
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
		const farPoint = findNearestNodeOnGraph(monacoOsm, graph, [10.0, 50.0], 100)
		expect(farPoint).toBeNull()
	})
})
