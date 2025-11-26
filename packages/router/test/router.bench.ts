import { Osm } from "@osmix/core"
import { getFixtureFile, PBFs } from "@osmix/shared/test/fixtures"
import { bench, group, run } from "mitata"
import { createOsmFromPbf } from "osmix"
import { buildGraph, findNearestNodeOnGraph } from "../src"
import { Router } from "../src/router"

/**
 * Router Benchmark Suite using mitata
 *
 * Run with: bun test/router.bench.ts
 *
 * These benchmarks compare the performance of different routing algorithms
 * using both real-world OSM data (Monaco) and synthetic grid networks.
 */

// ---------------------------------------------------------------------------
// Synthetic Grid Helper
// ---------------------------------------------------------------------------

/**
 * Creates a synthetic grid network for benchmarking.
 *
 * The grid consists of nodes arranged in a square pattern with
 * horizontal and vertical ways connecting adjacent nodes.
 *
 * @param size - Number of nodes in each dimension (size x size total)
 * @param spacing - Spacing between nodes in degrees (~100m per 0.001)
 */
function createSyntheticGrid(size: number, spacing: number): Osm {
	const osm = new Osm({ id: "synthetic-grid" })

	// Create nodes in a grid pattern
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			const nodeId = row * size + col + 1
			osm.nodes.addNode({
				id: nodeId,
				lat: row * spacing,
				lon: col * spacing,
			})
		}
	}

	osm.nodes.buildIndex()
	osm.nodes.buildSpatialIndex()

	// Create horizontal ways (connecting nodes in each row)
	let wayId = 1
	for (let row = 0; row < size; row++) {
		const refs: number[] = []
		for (let col = 0; col < size; col++) {
			refs.push(row * size + col + 1)
		}
		osm.ways.addWay({
			id: wayId++,
			refs,
			tags: { highway: "residential" },
		})
	}

	// Create vertical ways (connecting nodes in each column)
	for (let col = 0; col < size; col++) {
		const refs: number[] = []
		for (let row = 0; row < size; row++) {
			refs.push(row * size + col + 1)
		}
		osm.ways.addWay({
			id: wayId++,
			refs,
			tags: { highway: "residential" },
		})
	}

	osm.ways.buildIndex()
	osm.ways.buildSpatialIndex()
	osm.buildIndexes()

	return osm
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

console.log("Setting up benchmark data...")

// Load Monaco PBF
const monacoPbf = PBFs["monaco"]!
const pbfData = await getFixtureFile(monacoPbf.url)
const monacoOsm = await createOsmFromPbf(pbfData, {
	buildSpatialIndexes: ["node", "way"],
})
const monacoGraph = buildGraph(monacoOsm)
const monacoRouter = new Router(monacoOsm, monacoGraph)

// Create synthetic grid
const GRID_SIZE = 50
const GRID_SPACING = 0.001
const gridOsm = createSyntheticGrid(GRID_SIZE, GRID_SPACING)
const gridGraph = buildGraph(gridOsm)
const gridRouter = new Router(gridOsm, gridGraph)

// Pre-snap coordinates to node indexes for benchmarking
const monacoShortFrom = findNearestNodeOnGraph(
	monacoOsm,
	monacoGraph,
	[7.42, 43.735],
	500,
)!.nodeIndex
const monacoShortTo = findNearestNodeOnGraph(
	monacoOsm,
	monacoGraph,
	[7.425, 43.738],
	500,
)!.nodeIndex
const monacoLongFrom = findNearestNodeOnGraph(
	monacoOsm,
	monacoGraph,
	[7.41, 43.725],
	500,
)!.nodeIndex
const monacoLongTo = findNearestNodeOnGraph(
	monacoOsm,
	monacoGraph,
	[7.44, 43.745],
	500,
)!.nodeIndex

const gridShortFrom = findNearestNodeOnGraph(
	gridOsm,
	gridGraph,
	[0.01, 0.01],
	200,
)!.nodeIndex
const gridShortTo = findNearestNodeOnGraph(
	gridOsm,
	gridGraph,
	[0.015, 0.015],
	200,
)!.nodeIndex
const gridLongFrom = findNearestNodeOnGraph(
	gridOsm,
	gridGraph,
	[0, 0],
	200,
)!.nodeIndex
const gridLongTo = findNearestNodeOnGraph(
	gridOsm,
	gridGraph,
	[(GRID_SIZE - 1) * GRID_SPACING, (GRID_SIZE - 1) * GRID_SPACING],
	200,
)!.nodeIndex

console.log("Setup complete. Running benchmarks...\n")

// ---------------------------------------------------------------------------
// Monaco PBF Benchmarks
// ---------------------------------------------------------------------------

group("Monaco - Short Distance (~500m)", () => {
	bench("Dijkstra", () => {
		monacoRouter.route(monacoShortFrom, monacoShortTo, {
			algorithm: "dijkstra",
		})
	})

	bench("A*", () => {
		monacoRouter.route(monacoShortFrom, monacoShortTo, {
			algorithm: "astar",
		})
	})

	bench("Bidirectional", () => {
		monacoRouter.route(monacoShortFrom, monacoShortTo, {
			algorithm: "bidirectional",
		})
	})
})

group("Monaco - Long Distance (~2km)", () => {
	bench("Dijkstra", () => {
		monacoRouter.route(monacoLongFrom, monacoLongTo, {
			algorithm: "dijkstra",
		})
	})

	bench("A*", () => {
		monacoRouter.route(monacoLongFrom, monacoLongTo, {
			algorithm: "astar",
		})
	})

	bench("Bidirectional", () => {
		monacoRouter.route(monacoLongFrom, monacoLongTo, {
			algorithm: "bidirectional",
		})
	})
})

// ---------------------------------------------------------------------------
// Synthetic Grid Benchmarks
// ---------------------------------------------------------------------------

group("Grid 50x50 - Short Path", () => {
	bench("Dijkstra", () => {
		gridRouter.route(gridShortFrom, gridShortTo, {
			algorithm: "dijkstra",
		})
	})

	bench("A*", () => {
		gridRouter.route(gridShortFrom, gridShortTo, {
			algorithm: "astar",
		})
	})

	bench("Bidirectional", () => {
		gridRouter.route(gridShortFrom, gridShortTo, {
			algorithm: "bidirectional",
		})
	})
})

group("Grid 50x50 - Long Path (corner to corner)", () => {
	bench("Dijkstra", () => {
		gridRouter.route(gridLongFrom, gridLongTo, {
			algorithm: "dijkstra",
		})
	})

	bench("A*", () => {
		gridRouter.route(gridLongFrom, gridLongTo, {
			algorithm: "astar",
		})
	})

	bench("Bidirectional", () => {
		gridRouter.route(gridLongFrom, gridLongTo, {
			algorithm: "bidirectional",
		})
	})
})

// ---------------------------------------------------------------------------
// Router Initialization Benchmarks
// ---------------------------------------------------------------------------

group("Router Initialization", () => {
	bench("Monaco OSM (14k nodes, 3k ways)", () => {
		new Router(monacoOsm, buildGraph(monacoOsm))
	})

	bench("Grid 50x50 (2.5k nodes)", () => {
		new Router(gridOsm, buildGraph(gridOsm))
	})
})

// ---------------------------------------------------------------------------
// Run benchmarks
// ---------------------------------------------------------------------------

await run({
	colors: true,
})
