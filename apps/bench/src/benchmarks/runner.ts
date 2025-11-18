import type { GeoBbox2D } from "@osmix/shared/types"
import { OsmixRemote } from "osmix"
import type { BenchmarkResults, WorkerBenchmarkOptions } from "./types"

export type RunEngineBenchmark = (
	options: WorkerBenchmarkOptions,
) => Promise<BenchmarkResults>

export interface BenchmarkOptions {
	file: File
	onProgress: (metric: string) => void
	engines: RunEngineBenchmark[]
	repeat?: number
}

export async function runAllBenchmarks(
	options: BenchmarkOptions,
): Promise<BenchmarkResults[]> {
	const { file, onProgress } = options

	// Read file as ArrayBuffer
	const fileData = await file.arrayBuffer()
	const osmixRemote = await OsmixRemote.connect()
	const header = await osmixRemote.readHeader(fileData)
	if (!header.bbox) throw new Error("Header bbox not found")

	const bbox: GeoBbox2D = [
		header.bbox.left,
		header.bbox.bottom,
		header.bbox.right,
		header.bbox.top,
	]

	const results: BenchmarkResults[] = []
	for (let i = 0; i < (options.repeat ?? 1); i++) {
		for (const runEngine of options.engines) {
			const engineBenchmarkOptions: WorkerBenchmarkOptions = {
				fileData: fileData.slice(0),
				fileName: file.name,
				bbox,
				onProgress,
			}
			const result = await runEngine(engineBenchmarkOptions)
			results.push(result)
		}
	}

	return results
}
