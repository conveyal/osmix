import type { GeoBbox2D } from "@osmix/shared/types"

export type BenchmarkMetricType =
	| "Initialize"
	| "Load Speed"
	| "Build Spatial Indexes"
	| "Bbox Query (Small)"
	| "Bbox Query (Medium)"
	| "Bbox Query (Large)"
	| "Nearest Neighbor"
	| "GeoJSON Export"

export interface BenchmarkMetric {
	type: BenchmarkMetricType
	time: number | null
	result: string | null
	metadata?: Record<string, unknown>
}

export interface BenchmarkResults {
	engineName: string
	bbox: GeoBbox2D
	benchmarks: BenchmarkMetric[]
	geojson: GeoJSON.GeoJSON
}

export interface WorkerBenchmarkOptions {
	fileData: ArrayBuffer
	fileName: string
	bbox: GeoBbox2D
	onProgress: (message: string) => void
}
