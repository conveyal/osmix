import * as duckdb from "@duckdb/duckdb-wasm"
import eh_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url"
import mvp_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url"
import duckdb_wasm_eh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url"
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url"
import type { OsmNode, OsmTags, OsmWay } from "@osmix/json"
import type { GeoBbox2D } from "@osmix/shared/types"
import type * as arrow from "apache-arrow"

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
	mvp: {
		mainModule: duckdb_wasm,
		mainWorker: mvp_worker,
	},
	eh: {
		mainModule: duckdb_wasm_eh,
		mainWorker: eh_worker,
	},
}

export class DuckDBBenchWorker {
	private db: duckdb.AsyncDuckDB | null = null
	private conn: duckdb.AsyncDuckDBConnection | null = null
	private filePath: string | null = null

	async init() {
		const bundle = await duckdb.selectBundle(MANUAL_BUNDLES)
		const worker = new Worker(bundle.mainWorker!)
		const logger = new duckdb.ConsoleLogger()
		this.db = new duckdb.AsyncDuckDB(logger, worker)
		await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker)
		this.conn = await this.db.connect()

		// Install and load spatial extension
		await this.conn.query("INSTALL spatial;")
		await this.conn.query("LOAD spatial;")
	}

	isReady() {
		return this.conn !== null && this.db !== null
	}

	async loadFromPbf(data: ArrayBuffer, fileName: string): Promise<void> {
		if (!this.conn) throw new Error("Connection not initialized")

		// Register the file in DuckDB's filesystem
		this.filePath = `/${fileName}`
		await this.db!.registerFileBuffer(this.filePath, new Uint8Array(data))

		// Load OSM data using ST_ReadOSM
		await this.conn.query(`
			CREATE TABLE osm AS 
			SELECT * FROM ST_ReadOSM('${this.filePath}')
		`)
	}

	async createSpatialIndexes() {
		if (!this.conn) throw new Error("Connection not initialized")

		// TODO
	}

	async queryBbox(
		bbox: GeoBbox2D,
		includeTags = false,
	): Promise<{
		nodes: OsmNode[]
		ways: OsmWay[]
	}> {
		if (!this.conn) throw new Error("DuckDB not initialized")

		const [minLon, minLat, maxLon, maxLat] = bbox

		// Query nodes within bbox using spatial predicate
		const nodeResult = await this.conn.query(`
			SELECT id, lon, lat${includeTags ? ", tags" : ""}
			FROM osm
			WHERE kind = 'node'
				AND ST_Within(
					ST_Point(lon, lat),
					ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat})
				)
		`)

		const nodes: OsmNode[] = []
		for (let i = 0; i < nodeResult.numRows; i++) {
			const row = nodeResult.get(i)
			if (!row) continue
			// Convert to plain objects - tags may be a Map or complex object
			const tagsObj: Record<string, string> = {}
			if (includeTags && row.tags) {
				try {
					// Handle DuckDB MAP type
					if (typeof row.tags === "object" && row.tags !== null) {
						if (row.tags instanceof Map) {
							for (const [key, value] of row.tags.entries()) {
								tagsObj[String(key)] = String(value)
							}
						} else {
							// Already a plain object
							Object.assign(tagsObj, row.tags)
						}
					}
				} catch {
					// If conversion fails, leave tags empty
				}
			}
			nodes.push({
				id: Number(row.id),
				lon: Number(row.lon),
				lat: Number(row.lat),
				tags: tagsObj,
			})
		}

		// Query ways within bbox - use spatial predicate with CTE
		const wayResult = await this.conn.query(`
			WITH nodes_within_bbox AS (
				SELECT id FROM osm 
				WHERE kind = 'node'
					AND lon >= ${minLon} 
					AND lon <= ${maxLon} 
					AND lat >= ${minLat} 
					AND lat <= ${maxLat}
			)
			SELECT DISTINCT w.id, w.refs${includeTags ? ", w.tags" : ""}
			FROM osm w
			WHERE w.kind = 'way'
				AND EXISTS (
					SELECT 1 FROM unnest(w.refs) AS u(ref_id)
					WHERE ref_id IN (SELECT id FROM nodes_within_bbox)
				)
		`)

		const ways: OsmWay[] = []
		for (let i = 0; i < wayResult.numRows; i++) {
			const row = wayResult.get(i)
			if (!row) continue

			// Convert tags to plain object
			const tagsObj: Record<string, string> = {}
			if (includeTags && row.tags) {
				try {
					if (row.tags instanceof Map) {
						for (const [key, value] of row.tags.entries()) {
							tagsObj[String(key)] = String(value)
						}
					} else if (typeof row.tags === "object") {
						Object.assign(tagsObj, row.tags)
					}
				} catch {
					// If conversion fails, leave tags empty
				}
			}

			// Convert refs to plain array
			const refsArray: number[] = []
			if (row.refs) {
				try {
					if (Array.isArray(row.refs)) {
						refsArray.push(...row.refs.map(Number))
					} else if (
						typeof row.refs === "object" &&
						Symbol.iterator in row.refs
					) {
						for (const ref of row.refs as Iterable<unknown>) {
							refsArray.push(Number(ref))
						}
					}
				} catch {
					// If conversion fails, leave refs empty
				}
			}

			ways.push({
				id: Number(row.id),
				refs: refsArray,
				tags: tagsObj,
			})
		}

		return { nodes, ways }
	}

	async nearestNeighbor(
		lon: number,
		lat: number,
		count: number,
		includeTags = false,
	): Promise<OsmNode[]> {
		if (!this.conn) throw new Error("DuckDB not initialized")

		// Calculate distance using spatial function and sort
		const result = await this.conn.query(`
			SELECT id, lon, lat${includeTags ? ", tags" : ""},
				ST_Distance(
					ST_Point(lon, lat),
					ST_Point(${lon}, ${lat})
				) as distance
			FROM osm
			WHERE kind = 'node'
			ORDER BY distance
			LIMIT ${count}
		`)

		const nodes: OsmNode[] = []
		for (let i = 0; i < result.numRows; i++) {
			const row = result.get(i)
			if (!row) continue

			// Convert tags to plain object
			const tagsObj: Record<string, string> = {}
			if (includeTags && row.tags) {
				try {
					if (row.tags instanceof Map) {
						for (const [key, value] of row.tags.entries()) {
							tagsObj[String(key)] = String(value)
						}
					} else if (typeof row.tags === "object") {
						Object.assign(tagsObj, row.tags)
					}
				} catch {
					// If conversion fails, leave tags empty
				}
			}

			nodes.push({
				id: Number(row.id),
				lon: Number(row.lon),
				lat: Number(row.lat),
				tags: tagsObj,
			})
		}

		return nodes
	}

	async generateVectorTile(bbox: GeoBbox2D): Promise<Uint8Array> {
		if (!this.conn) throw new Error("DuckDB not initialized")

		// Simple implementation - just query the data
		const result = await this.queryBbox(bbox)
		const json = JSON.stringify(result)
		return new TextEncoder().encode(json)
	}

	async getGeoJSON(): Promise<GeoJSON.FeatureCollection> {
		if (!this.conn) throw new Error("DuckDB not initialized")

		const features: GeoJSON.Feature<
			GeoJSON.Point | GeoJSON.LineString,
			OsmTags
		>[] = []

		// Get all interesting nodes
		const nodesResult = await this.conn.query(`
			SELECT id, tags, lon, lat
			FROM osm
			WHERE kind = 'node'
				AND tags IS NOT NULL
				AND cardinality(tags) > 0
		`)
		for (let i = 0; i < nodesResult.numRows; i++) {
			const nodeRow = nodesResult.get(i)
			if (!nodeRow) continue
			const tags: OsmTags = {}
			for (const [key, value] of nodeRow.tags ?? {}) {
				tags[key] = value
			}
			features.push({
				type: "Feature",
				id: Number(nodeRow.id),
				geometry: {
					type: "Point",
					coordinates: [nodeRow.lon, nodeRow.lat],
				},
				properties: tags,
			})
		}

		// Get first N ways
		const waysResult = await this.conn.query(`
WITH node_maps AS (
	SELECT
    	MAP(list(id), list(lat)) AS latmap,
    	MAP(list(id), list(lon)) AS lonmap
  	FROM osm
	WHERE kind = 'node'
)
SELECT
	w.id,
	w.tags,
	w.refs,
	list_transform(w.refs, r -> nm.latmap[r]) AS lats,
	list_transform(w.refs, r -> nm.lonmap[r]) AS lons
FROM osm AS w
CROSS JOIN node_maps AS nm
WHERE w.kind = 'way'
		`)

		// For each way, get its nodes and construct GeoJSON
		for (let i = 0; i < waysResult.numRows; i++) {
			const wayRow = waysResult.get(i)
			if (!wayRow) continue

			if (wayRow.lats.length >= 2 && wayRow.lons.length >= 2) {
				const lats = wayRow.lats as arrow.Vector<arrow.Float64>
				const lons = wayRow.lons as arrow.Vector<arrow.Float64>

				const coordinates: number[][] = []
				for (let i = 0; i < lats.length; i++) {
					const lon = lons.get(i)
					const lat = lats.get(i)
					if (lon === null || lat === null) throw Error("Invalid coordinate")
					coordinates.push([lon, lat])
				}
				// Convert tags
				const tags: OsmTags = {}
				for (const [key, value] of wayRow.tags ?? {}) {
					tags[key] = value
				}
				features.push({
					type: "Feature",
					id: Number(wayRow.id),
					geometry: {
						type: "LineString",
						coordinates,
					},
					properties: tags,
				} as GeoJSON.Feature<GeoJSON.LineString, OsmTags>)
			}
		}

		return {
			type: "FeatureCollection",
			features,
		}
	}

	async getStats() {
		if (!this.conn) return null

		const result = await this.conn.query(`
			SELECT 
				kind,
				COUNT(*) as count
			FROM osm
			WHERE kind IN ('node', 'way', 'relation')
			GROUP BY kind
		`)

		const stats: Record<string, { count: number }> = {}
		for (let i = 0; i < result.numRows; i++) {
			const row = result.get(i)
			if (!row) continue
			stats[String(row.kind)] = {
				count: Number(row.count),
			}
		}

		return stats
	}
}
