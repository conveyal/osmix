import { calculateTestGeometriesFromBbox } from "../utils"
import { DuckDBBenchWorker } from "../workers/duckdb.worker"
import type {
	BenchmarkMetric,
	BenchmarkMetricType,
	BenchmarkResults,
	WorkerBenchmarkOptions,
} from "./types"

export async function runDuckDBBenchmarks(
	options: WorkerBenchmarkOptions,
): Promise<BenchmarkResults> {
	const { fileData, fileName, bbox, onProgress } = options

	onProgress("DuckDB: Running benchmarks...")
	const { bboxes, centerLon, centerLat } = calculateTestGeometriesFromBbox(bbox)

	const benchmarks: BenchmarkMetric[] = []
	const startBenchmark = (type: BenchmarkMetricType) => {
		const startTime = performance.now()
		return function finishBenchmark(result: string) {
			const endTime = performance.now()
			const time = endTime - startTime
			benchmarks.push({
				type,
				time,
				result,
			})
		}
	}

	// Initialize DuckDB worker
	onProgress("DuckDB: Initializing worker...")
	const initBenchmark = startBenchmark("Initialize")
	const duckdbWorker = new DuckDBBenchWorker()
	await duckdbWorker.init()
	initBenchmark("Done")

	// Load speed (includes DuckDB initialization)
	onProgress("DuckDB: Loading file...")
	const loadBenchmark = startBenchmark("Load Speed")
	await duckdbWorker.loadFromPbf(fileData, fileName)

	// Get stats after load
	const stats = await duckdbWorker.getStats()
	loadBenchmark(
		`${(stats?.node?.count ?? 0).toLocaleString()} nodes, ${(stats?.way?.count ?? 0).toLocaleString()} ways, ${(stats?.relation?.count ?? 0).toLocaleString()} relations`,
	)

	// Build spatial indexes
	onProgress("DuckDB: Building spatial indexes...")
	const buildSpatialIndexesBenchmark = startBenchmark("Build Spatial Indexes")
	await duckdbWorker.createSpatialIndexes()
	buildSpatialIndexesBenchmark("Done")

	// Bbox queries
	onProgress("DuckDB: Running small bbox query...")
	const bboxSmallBenchmark = startBenchmark("Bbox Query (Small)")
	const bboxSmallData = await duckdbWorker.queryBbox(bboxes.small)
	bboxSmallBenchmark(
		`${bboxSmallData.nodes.length.toLocaleString()} nodes, ${bboxSmallData.ways.length.toLocaleString()} ways`,
	)

	onProgress("DuckDB: Running medium bbox query...")
	const bboxMediumBenchmark = startBenchmark("Bbox Query (Medium)")
	const bboxMediumData = await duckdbWorker.queryBbox(bboxes.medium)
	bboxMediumBenchmark(
		`${bboxMediumData.nodes.length.toLocaleString()} nodes, ${bboxMediumData.ways.length.toLocaleString()} ways`,
	)

	onProgress("DuckDB: Running large bbox query...")
	const bboxLargeBenchmark = startBenchmark("Bbox Query (Large)")
	const bboxLargeData = await duckdbWorker.queryBbox(bboxes.large)
	bboxLargeBenchmark(
		`${bboxLargeData.nodes.length.toLocaleString()} nodes, ${bboxLargeData.ways.length.toLocaleString()} ways`,
	)

	// Nearest neighbor (top 5)
	onProgress("DuckDB: Running nearest neighbor query...")
	const nnBenchmark = startBenchmark("Nearest Neighbor")
	const nnData = await duckdbWorker.nearestNeighbor(centerLon, centerLat, 5)
	nnBenchmark(`nodes ids: ${nnData.map((n) => `${n.id}`).join(", ")}`)

	// 4. GeoJSON export (first 10 ways)
	onProgress?.("DuckDB: Exporting GeoJSON...")
	const gjBenchmark = startBenchmark("GeoJSON Export")
	const gjData = await duckdbWorker.getGeoJSON()
	gjBenchmark(`${gjData.features.length.toLocaleString()} entities`)

	return {
		engineName: "DuckDB",
		bbox,
		benchmarks,
		geojson: gjData,
	}
}
