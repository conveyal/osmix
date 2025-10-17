import { calculateTestGeometriesFromBbox } from "@/utils"
import { createWorker } from "@/workers/osmix.worker"
import type {
	BenchmarkMetric,
	BenchmarkMetricType,
	BenchmarkResults,
	WorkerBenchmarkOptions,
} from "./types"

export async function runOsmixBenchmarks(
	options: WorkerBenchmarkOptions,
): Promise<BenchmarkResults> {
	const { bbox, fileData, onProgress } = options
	onProgress("Osmix: Running benchmarks...")
	const benchmarks: BenchmarkMetric[] = []
	// Calculate center and bboxes from the data
	const { bboxes, centerLon, centerLat } = calculateTestGeometriesFromBbox(bbox)
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

	// Init
	const initBenchmark = startBenchmark("Initialize")
	const osmixWorker = createWorker()
	initBenchmark("Done")

	// Load speed
	onProgress("Osmix: Loading file...")
	const loadBenchmark = startBenchmark("Load Speed")
	await osmixWorker.loadFromPbf(fileData)

	// Get bbox and stats from loaded data
	const stats = await osmixWorker.getStats()
	if (!stats) throw new Error("Failed to get Osmix stats")
	loadBenchmark(
		`${stats.nodes.toLocaleString()} nodes, ${stats.ways.toLocaleString()} ways, ${stats.relations.toLocaleString()} relations`,
	)

	// Build spatial indexes
	onProgress("Osmix: Building spatial indexes...")
	const buildSpatialIndexesBenchmark = startBenchmark("Build Spatial Indexes")
	await osmixWorker.buildSpatialIndexes()
	buildSpatialIndexesBenchmark("Done")

	// 2. Bbox queries
	onProgress("Osmix: Running small bbox query...")
	const bboxSmallBenchmark = startBenchmark("Bbox Query (Small)")
	const bboxSmallData = await osmixWorker.queryBbox(bboxes.small)
	bboxSmallBenchmark(
		`${bboxSmallData.nodes.length.toLocaleString()} nodes, ${bboxSmallData.ways.length.toLocaleString()} ways`,
	)

	onProgress("Osmix: Running medium bbox query...")
	const bboxMediumBenchmark = startBenchmark("Bbox Query (Medium)")
	const bboxMediumData = await osmixWorker.queryBbox(bboxes.medium)
	bboxMediumBenchmark(
		`${bboxMediumData.nodes.length.toLocaleString()} nodes, ${bboxMediumData.ways.length.toLocaleString()} ways`,
	)

	onProgress("Osmix: Running large bbox query...")
	const bboxLargeBenchmark = startBenchmark("Bbox Query (Large)")
	const bboxLargeData = await osmixWorker.queryBbox(bboxes.large)
	bboxLargeBenchmark(
		`${bboxLargeData.nodes.length.toLocaleString()} nodes, ${bboxLargeData.ways.length.toLocaleString()} ways`,
	)

	// Nearest neighbor (top 5)
	onProgress("Osmix: Running nearest neighbor query...")
	const nnBenchmark = startBenchmark("Nearest Neighbor")
	const nnData = await osmixWorker.nearestNeighbor(centerLon, centerLat, 5)
	nnBenchmark(`nodes ids: ${nnData.map((n) => `${n.id}`).join(", ")}`)

	// 4. GeoJSON export (first 10 ways)
	onProgress("Osmix: Exporting GeoJSON...")
	const gjBenchmark = startBenchmark("GeoJSON Export")
	const gjData = await osmixWorker.exportWaysGeoJSON()
	gjBenchmark(`${gjData.features.length.toLocaleString()} entities`)
	return {
		engineName: "Osmix",
		bbox,
		benchmarks,
		geojson: gjData,
	}
}
