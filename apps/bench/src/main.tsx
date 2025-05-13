import type { GeoBbox2D } from "@osmix/shared/types"
import {
	StrictMode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { createRoot } from "react-dom/client"
import { Layer, Map as MaplibreMap, Source } from "react-map-gl/maplibre"
import { runDuckDBBenchmarks } from "./benchmarks/duckdb-bench"
import { runOsmixBenchmarks } from "./benchmarks/osmix-bench"
import { runAllBenchmarks } from "./benchmarks/runner"
import type { BenchmarkMetricType, BenchmarkResults } from "./benchmarks/types"

interface BenchmarkStatus {
	status: "idle" | "running" | "completed" | "error"
	currentMetric: string | null
	error: string | null
}

function App() {
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [log, setLog] = useState<BenchmarkStatus[]>([])
	const currentStatus = useMemo(() => log[log.length - 1], [log])
	const pushStatus = useCallback((status: BenchmarkStatus) => {
		setLog((prev) => [...prev, status])
	}, [])
	const [results, setResults] = useState<BenchmarkResults[]>([])
	const fileInputRef = useRef<HTMLInputElement>(null)
	const autoLoadAttemptedRef = useRef(false)

	const handleRunBenchmark = useCallback(
		async (file: File) => {
			setLog([])
			pushStatus({
				status: "running",
				currentMetric: "Starting benchmarks...",
				error: null,
			})
			setResults([])

			try {
				const benchResults = await runAllBenchmarks({
					file,
					onProgress: (metric) => {
						pushStatus({
							status: "running",
							currentMetric: metric,
							error: null,
						})
					},
					engines: [runOsmixBenchmarks, runDuckDBBenchmarks],
				})

				setResults(benchResults)
				pushStatus({
					status: "completed",
					currentMetric: null,
					error: null,
				})
			} catch (error) {
				console.error("Benchmark error:", error)
				pushStatus({
					status: "error",
					currentMetric: null,
					error: error instanceof Error ? error.message : "Unknown error",
				})
			}
		},
		[pushStatus],
	)

	// Auto-load default file in development
	useEffect(() => {
		if (import.meta.env.DEV && !selectedFile && !autoLoadAttemptedRef.current) {
			autoLoadAttemptedRef.current = true
			fetch("/monaco.pbf")
				.then((res) => res.blob())
				.then((blob) => {
					const file = new File([blob], "monaco.pbf")
					setSelectedFile(file)
					handleRunBenchmark(file)
				})
				.catch((err) => {
					console.error("Failed to load default file:", err)
				})
		}
	}, [selectedFile, handleRunBenchmark])

	const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (file) {
			setSelectedFile(file)
			handleRunBenchmark(file)
		}
	}

	return (
		<div>
			<h1>Osmix vs DuckDB Benchmark</h1>

			<div>
				<input
					ref={fileInputRef}
					type="file"
					accept=".pbf,.osm.pbf"
					onChange={handleFileSelect}
				/>
				{selectedFile && currentStatus.status !== "running" && (
					<button
						type="button"
						onClick={() => handleRunBenchmark(selectedFile)}
					>
						Run Again
					</button>
				)}
			</div>

			{selectedFile && (
				<p>
					File: {selectedFile.name} (
					{(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
				</p>
			)}

			{!currentStatus ||
				(currentStatus.status === "idle" && !selectedFile && (
					<div>
						<p>Select an OSM PBF file to begin benchmarking.</p>
					</div>
				))}

			{currentStatus?.status === "running" && (
				<div>
					<h2>Running Benchmarks...</h2>
					<div
						style={{
							border: "1px solid black",
							padding: "0.5rem 1rem",
							overflowY: "auto",
							maxHeight: "200px",
						}}
					>
						<pre style={{ fontWeight: "bold" }}>
							{currentStatus.currentMetric}
						</pre>
						<pre>
							{log
								.slice(0, -1)
								.toReversed()
								.map((status) => status.currentMetric)
								.join("\n")}
						</pre>
					</div>
				</div>
			)}

			{currentStatus?.status === "error" && (
				<div>
					<h2>Benchmark Failed</h2>
					<p>Error: {currentStatus.error}</p>
				</div>
			)}

			{currentStatus?.status === "completed" && results && (
				<div>
					<BenchmarkResultsView results={results} />
				</div>
			)}
		</div>
	)
}

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("Root element not found")

createRoot(rootEl).render(
	<StrictMode>
		<App />
	</StrictMode>,
)

const metricDescriptions: Record<BenchmarkMetricType, string> = {
	Initialize: "Time to initialize the engine",
	"Load Speed": "Time to load and index the OSM PBF file",
	"Build Spatial Indexes": "Time to build the spatial indexes",
	"Bbox Query (Small)": "Time to query a small bbox",
	"Bbox Query (Medium)": "Time to query a medium bbox",
	"Bbox Query (Large)": "Time to query a large bbox",
	"Nearest Neighbor": "Time to find the nearest neighbors",
	"GeoJSON Export": "Time to export the first 10 ways as GeoJSON",
}

function getMetricId(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

export function BenchmarkResultsView({
	results,
}: {
	results: BenchmarkResults[]
}) {
	// Calculate overall winner
	const [osmixResults, duckdbResults] = results
	if (!osmixResults || !duckdbResults) return null
	let osmixWins = 0
	let duckdbWins = 0
	for (let i = 0; i < osmixResults.benchmarks.length; i++) {
		const osmixMetric = osmixResults.benchmarks[i]
		const duckdbMetric = duckdbResults.benchmarks[i]
		if ((osmixMetric?.time ?? 0) < (duckdbMetric?.time ?? 0)) {
			osmixWins++
		} else {
			duckdbWins++
		}
	}

	return (
		<div>
			<h1>Benchmark Results</h1>
			<p>
				Score: Osmix {osmixWins} / DuckDB {duckdbWins}
			</p>

			<table>
				<thead>
					<tr>
						<th>Metric</th>
						<th>Osmix Time</th>
						<th>Osmix Results</th>
						<th>DuckDB Time</th>
						<th>DuckDB Results</th>
						<th>Comparison</th>
					</tr>
				</thead>
				<tbody>
					{osmixResults.benchmarks.map((osmixMetric, i) => {
						const duckdbMetric = duckdbResults.benchmarks[i]
						const metricId = getMetricId(osmixMetric.type)

						if (
							osmixMetric.time === null ||
							duckdbMetric == null ||
							duckdbMetric.time === null
						) {
							return (
								<tr key={osmixMetric.type}>
									<td>
										<a href={`#${metricId}`}>{osmixMetric.type}</a>
									</td>
									<td>{osmixMetric.time?.toFixed(2) ?? "—"} ms</td>
									<td>{osmixMetric.result ?? "—"}</td>
									<td>{duckdbMetric?.time?.toFixed(2) ?? "—"} ms</td>
									<td>{duckdbMetric?.result ?? "—"}</td>
									<td>—</td>
								</tr>
							)
						}

						const osmixFaster = osmixMetric.time < duckdbMetric.time
						const ratio = osmixFaster
							? duckdbMetric.time / osmixMetric.time
							: osmixMetric.time / duckdbMetric.time
						const winner = osmixFaster ? "Osmix" : "DuckDB"
						const comparison = `${winner} is ${ratio.toFixed(1)}x faster`

						return (
							<tr key={osmixMetric.type}>
								<td>
									<div className="tooltip">
										{osmixMetric.type}
										<span className="tooltiptext">
											{metricDescriptions[osmixMetric.type]}
										</span>
									</div>
								</td>
								<td>{osmixMetric.time?.toFixed(2) ?? "—"} ms</td>
								<td>{osmixMetric.result ?? "—"}</td>
								<td>{duckdbMetric.time?.toFixed(2) ?? "—"} ms</td>
								<td>{duckdbMetric.result ?? "—"}</td>
								<td>{comparison}</td>
							</tr>
						)
					})}
				</tbody>
			</table>

			<h2>GeoJSON Results</h2>
			<table>
				<thead>
					<tr>
						<th>Osmix</th>
						<th>DuckDB</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td style={{ width: "50%", height: "500px" }}>
							<MapView
								bbox={osmixResults.bbox}
								geojson={osmixResults.geojson}
								color="red"
							/>
						</td>
						<td style={{ width: "50%", height: "500px" }}>
							<MapView
								bbox={duckdbResults.bbox}
								geojson={duckdbResults.geojson}
								color="yellow"
							/>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	)
}

interface MapViewProps {
	bbox: GeoBbox2D
	geojson: GeoJSON.GeoJSON
	color: string
}

export function MapView({ bbox, color, geojson }: MapViewProps) {
	const [entity, setEntity] = useState<{
		type: "way" | "node"
		id: number
		tags: Record<string, string>
	} | null>(null)
	return (
		<MaplibreMap
			reuseMaps={true}
			initialViewState={{
				bounds: bbox,
				longitude: (bbox[0] + bbox[2]) / 2,
				latitude: (bbox[1] + bbox[3]) / 2,
				zoom: 12,
			}}
			mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
			style={{ width: "100%", height: "100%" }}
			ref={(map) => {
				if (!map) return
				map.on("mousemove", ["ways", "nodes"], (e) => {
					const feature = e.features?.[0]
					if (feature) {
						setEntity({
							type: feature.layer.id === "ways" ? "way" : "node",
							id: Number(feature.id),
							tags: feature.properties ?? {},
						})
					}
				})
			}}
		>
			<Source type="geojson" data={geojson}>
				<Layer
					type="line"
					paint={{ "line-color": color, "line-width": 1 }}
					filter={["==", ["geometry-type"], "LineString"]}
					id="ways"
				/>
				<Layer
					type="circle"
					paint={{ "circle-color": color, "circle-radius": 2 }}
					filter={["==", ["geometry-type"], "Point"]}
					id="nodes"
				/>
			</Source>

			<div
				style={{
					position: "absolute",
					fontFamily: "monospace",
					top: 5,
					left: 5,
					zIndex: 1000,
					backgroundColor: "white",
					width: "200px",
					maxHeight: "200px",
					overflowY: "auto",
					borderRadius: "1px",
					boxShadow: "0 0 10px 0 rgba(0, 0, 0, 0.1)",
				}}
			>
				{entity ? (
					<div>
						<div style={{ padding: "0.1rem 0.2rem" }}>
							{entity.type}/{entity.id}
						</div>
						<table className="map-control-table">
							<tbody>
								{Object.entries(entity.tags).map(([key, value]) => (
									<tr key={key}>
										<td>{key}</td>
										<td>{value}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div style={{ padding: "0.1rem 0.2rem" }}>hover over entity</div>
				)}
			</div>
		</MaplibreMap>
	)
}
