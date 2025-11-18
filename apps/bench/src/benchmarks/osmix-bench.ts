import type { Osm } from "@osmix/core"
import {
	nodeToFeature,
	type OsmGeoJSONFeature,
	wayToFeature,
} from "@osmix/geojson"
import { haversineDistance } from "@osmix/shared/haversine-distance"
import type { GeoBbox2D, OsmNode, OsmWay } from "@osmix/shared/types"
import { OsmixRemote } from "osmix"
import { calculateTestGeometriesFromBbox } from "../utils"
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
	const osmix = await OsmixRemote.connect({
		onProgress: (p) => onProgress(p.msg),
	})
	initBenchmark("Done")

	// Load speed
	onProgress("Osmix: Loading file...")
	const loadBenchmark = startBenchmark("Load Speed")
	const osmInfo = await osmix.fromPbf(fileData)
	const osm = await osmix.get(osmInfo.id)
	const stats = osmInfo.stats

	// Get bbox and stats from loaded data
	if (!stats) throw new Error("Failed to get Osmix stats")
	loadBenchmark(
		`${stats.nodes.toLocaleString()} nodes, ${stats.ways.toLocaleString()} ways, ${stats.relations.toLocaleString()} relations`,
	)

	// Build spatial indexes
	onProgress("Osmix: Building spatial indexes...")
	const buildSpatialIndexesBenchmark = startBenchmark("Build Spatial Indexes")
	osm.buildSpatialIndexes()
	buildSpatialIndexesBenchmark("Done")

	// 2. Bbox queries
	onProgress("Osmix: Running small bbox query...")
	const bboxSmallBenchmark = startBenchmark("Bbox Query (Small)")
	const bboxSmallData = queryBbox(osm, bboxes.small)
	bboxSmallBenchmark(
		`${bboxSmallData.nodes.length.toLocaleString()} nodes, ${bboxSmallData.ways.length.toLocaleString()} ways`,
	)

	onProgress("Osmix: Running medium bbox query...")
	const bboxMediumBenchmark = startBenchmark("Bbox Query (Medium)")
	const bboxMediumData = queryBbox(osm, bboxes.medium)
	bboxMediumBenchmark(
		`${bboxMediumData.nodes.length.toLocaleString()} nodes, ${bboxMediumData.ways.length.toLocaleString()} ways`,
	)

	onProgress("Osmix: Running large bbox query...")
	const bboxLargeBenchmark = startBenchmark("Bbox Query (Large)")
	const bboxLargeData = queryBbox(osm, bboxes.large)
	bboxLargeBenchmark(
		`${bboxLargeData.nodes.length.toLocaleString()} nodes, ${bboxLargeData.ways.length.toLocaleString()} ways`,
	)

	// Nearest neighbor (top 5)
	onProgress("Osmix: Running nearest neighbor query...")
	const nnBenchmark = startBenchmark("Nearest Neighbor")
	const nnData = nearestNeighbor(osm, centerLon, centerLat, 5)
	nnBenchmark(`nodes ids: ${nnData.map((n) => `${n.id}`).join(", ")}`)

	// 4. GeoJSON export (first 10 ways)
	onProgress("Osmix: Exporting GeoJSON...")
	const gjBenchmark = startBenchmark("GeoJSON Export")
	const gjData = exportWaysGeoJSON(osm)
	gjBenchmark(`${gjData.features.length.toLocaleString()} entities`)
	return {
		engineName: "Osmix",
		bbox,
		benchmarks,
		geojson: gjData,
	}
}

function queryBbox(
	osm: Osm,
	bbox: GeoBbox2D,
	includeTags = false,
): {
	nodes: OsmNode[]
	ways: OsmWay[]
} {
	const { nodes, ways } = osm
	const nodesWithTags = nodes.withinBbox(
		bbox,
		(i) => nodes.tags.cardinality(i) > 0,
	)
	const wayResults = ways.withinBbox(bbox)

	const nodesWithinBbox: OsmNode[] = []
	for (let i = 0; i < nodesWithTags.ids.length; i++) {
		const id = nodesWithTags.ids[i]
		if (!id) continue
		const lon = nodesWithTags.positions[i * 2]
		const lat = nodesWithTags.positions[i * 2 + 1]
		if (lon === undefined || lat === undefined) continue
		if (includeTags) {
			const node = nodes.getById(id)
			nodesWithinBbox.push({ id, lon, lat, tags: node?.tags ?? undefined })
		} else {
			nodesWithinBbox.push({ id, lon, lat })
		}
	}

	const waysInBbox: OsmWay[] = []
	for (let i = 0; i < wayResults.ids.length; i++) {
		const id = wayResults.ids[i]
		if (!id) continue
		if (includeTags) {
			const way = ways.getById(id)
			waysInBbox.push({
				id,
				refs: way?.refs ?? [],
				tags: way?.tags ?? undefined,
			})
		} else {
			waysInBbox.push({ id, refs: [] })
		}
	}

	return { nodes: nodesWithinBbox, ways: waysInBbox }
}

function nearestNeighbor(
	osm: Osm,
	lon: number,
	lat: number,
	count: number,
): OsmNode[] {
	// Use withinRadius with a reasonable search radius
	const candidates = osm.nodes.findIndexesWithinRadius(lon, lat, 0.1)

	// Calculate distances and sort
	const nodesWithDistance: Array<{
		nodeIndex: number
		id: number
		lon: number
		lat: number
		distance: number
	}> = []

	for (const nodeIndex of candidates) {
		const id = osm.nodes.ids.at(nodeIndex)
		const [nodeLon, nodeLat] = osm.nodes.getNodeLonLat({
			index: nodeIndex,
		})
		const distance = haversineDistance([lon, lat], [nodeLon, nodeLat])
		nodesWithDistance.push({
			nodeIndex,
			id,
			lon: nodeLon,
			lat: nodeLat,
			distance,
		})
	}

	// Sort by distance and take top N
	nodesWithDistance.sort((a, b) => a.distance - b.distance)

	return nodesWithDistance.slice(0, count).map((n) => ({
		id: n.id,
		lon: n.lon,
		lat: n.lat,
	}))
}

function exportWaysGeoJSON(
	osm: Osm,
	limit = Number.POSITIVE_INFINITY,
): GeoJSON.FeatureCollection {
	const features: OsmGeoJSONFeature<
		GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon
	>[] = []

	const { nodes } = osm
	for (const node of nodes) {
		if (!node.tags || Object.keys(node.tags).length === 0) continue
		features.push(nodeToFeature(node))
	}

	for (const way of osm.ways) {
		if (features.length >= limit) break
		features.push(wayToFeature(way, (ref) => nodes.getNodeLonLat({ id: ref })))
	}

	return {
		type: "FeatureCollection",
		features,
	}
}
