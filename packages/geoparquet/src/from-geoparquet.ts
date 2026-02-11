/**
 * GeoParquet to OSM conversion utilities.
 *
 * Imports GeoParquet files into Osm indexes, mapping geometry
 * types to appropriate OSM entity structures.
 *
 * @module
 */

import { Osm, type OsmOptions } from "@osmix/core"
import {
	logProgress,
	type ProgressEvent,
	progressEvent,
} from "@osmix/shared/progress"
import type { OsmRelationMember, OsmTags } from "@osmix/shared/types"
import { rewindFeature } from "@placemarkio/geojson-rewind"
import type {
	Geometry,
	LineString,
	MultiLineString,
	MultiPolygon,
	Point,
	Polygon,
} from "geojson"
import {
	type AsyncBuffer,
	asyncBufferFromUrl,
	type ParquetReadOptions,
	parquetReadObjects,
} from "hyparquet"
import type { GeoParquetReadOptions, GeoParquetSource } from "./types"
import { parseWkb } from "./wkb"

/**
 * Create an Osm index from GeoParquet data.
 *
 * Accepts various input formats (file path, URL, or buffer) and converts
 * features to OSM entities:
 * - Point → Node
 * - LineString → Way with nodes
 * - Polygon → Way (simple) or Relation (with holes)
 * - MultiPolygon → Relation
 *
 * Feature IDs are preserved if available; otherwise sequential negative IDs
 * are assigned. Feature tags become OSM tags.
 *
 * @param source - GeoParquet data source (file path, URL, or buffer)
 * @param options - Osm index options (id, header)
 * @param readOptions - Options for reading the parquet file
 * @param onProgress - Progress callback for UI feedback
 * @returns Populated Osm index with built indexes
 *
 * @example
 * ```ts
 * import { fromGeoParquet } from "@osmix/geoparquet"
 *
 * // From file
 * const osm = await fromGeoParquet("./roads.parquet")
 *
 * // Query the imported data
 * const highways = osm.ways.search("highway")
 * ```
 */
export async function fromGeoParquet(
	source: GeoParquetSource,
	options: Partial<OsmOptions> = {},
	readOptions: GeoParquetReadOptions = {},
	onProgress: (progress: ProgressEvent) => void = logProgress,
): Promise<Osm> {
	const builder = new GeoParquetOsmBuilder(options, readOptions, onProgress)

	onProgress(progressEvent("Loading GeoParquet file..."))

	// Read rows from parquet file
	const rows = await builder.readParquetRows(source)

	onProgress(progressEvent(`Processing ${rows.length} features...`))

	// Convert to OSM entities
	builder.processGeoParquetRows(rows)

	return builder.buildOsm()
}

export class GeoParquetOsmBuilder {
	private osm: Osm
	private readOptions: GeoParquetReadOptions
	private onProgress: (progress: ProgressEvent) => void

	constructor(
		osmOptions: Partial<OsmOptions> = {},
		readOptions: GeoParquetReadOptions = {},
		onProgress: (progress: ProgressEvent) => void = logProgress,
	) {
		this.osm = new Osm(osmOptions)
		this.readOptions = readOptions
		this.onProgress = onProgress
	}

	async readParquetRows(source: GeoParquetSource) {
		let file: AsyncBuffer
		if (typeof source === "string") {
			// String sources are treated as URLs
			this.onProgress(progressEvent(`Fetching from URL: ${source}`))
			file = await asyncBufferFromUrl({ url: source })
		} else if (source instanceof URL) {
			this.onProgress(progressEvent(`Fetching from URL: ${source.href}`))
			file = await asyncBufferFromUrl({ url: source.href })
		} else if (source instanceof ArrayBuffer) {
			// Wrap ArrayBuffer as AsyncBuffer
			file = {
				byteLength: source.byteLength,
				slice: (start: number, end?: number) => source.slice(start, end),
			}
		} else {
			// Assume it's already an AsyncBuffer
			file = source
		}

		const readConfig: Omit<ParquetReadOptions, "onComplete"> = {
			file,
			...this.readOptions,
			columns: [
				this.readOptions.typeColumn ?? "type",
				this.readOptions.idColumn ?? "id",
				this.readOptions.geometryColumn ?? "geometry",
				this.readOptions.tagsColumn ?? "tags",
				this.readOptions.bboxColumn ?? "bbox",
			],
		}

		this.onProgress(progressEvent("Reading parquet data..."))
		return parquetReadObjects(readConfig)
	}

	/**
	 * Converts GeoParquet rows to OSM entities.
	 */
	processGeoParquetRows(rows: Record<string, unknown>[]) {
		this.onProgress(progressEvent("Converting GeoParquet to Osmix..."))

		const idColumn = this.readOptions.idColumn ?? "id"
		const typeColumn = this.readOptions.typeColumn ?? "type"
		const geometryColumn = this.readOptions.geometryColumn ?? "geometry"
		const tagsColumn = this.readOptions.tagsColumn ?? "tags"

		// Process each row
		let count = 0
		let skippedInvalidGeometries = 0
		for (const row of rows) {
			// Extract values using column names
			// biome-ignore lint/suspicious/noExplicitAny: dynamic column access
			const rowAny = row as any
			const id = rowAny[idColumn] as bigint | number
			const type = rowAny[typeColumn] as "node" | "way" | "relation"
			const geometryData = rowAny[geometryColumn] as
				| Uint8Array
				| GeoJSON.Geometry
				| string
			const tagsData = rowAny[tagsColumn] as
				| Record<string, string | number>
				| string
			if (!geometryData) {
				count++
				continue
			}

			// Parse WKB geometry
			let geometry: Geometry
			try {
				if (geometryData instanceof Uint8Array) {
					geometry = parseWkb(geometryData)
				} else if (typeof geometryData === "string") {
					geometry = JSON.parse(geometryData) as Geometry
				} else {
					geometry = geometryData
				}
			} catch {
				// Skip invalid geometries
				skippedInvalidGeometries++
				count++
				continue
			}

			// Parse tags
			const tags = parseTags(tagsData)

			// Get numeric ID from bigint or generate one
			const numericId =
				id !== undefined
					? typeof id === "bigint"
						? Number(id)
						: id
					: undefined

			// Normalize geometry winding order
			const normalizedGeometry = normalizeGeometry(geometry)

			if (normalizedGeometry.type === "Point") {
				this.processPoint(normalizedGeometry, numericId, tags)
			} else if (normalizedGeometry.type === "LineString") {
				this.processLineString(normalizedGeometry, numericId, tags)
			} else if (normalizedGeometry.type === "Polygon") {
				if (type === "node")
					throw Error(
						`ID: ${numericId} has type 'node' but geometry is a polygon`,
					)
				// Infer type from geometry if missing: relation if has holes, way otherwise
				const polygonType =
					type ??
					(normalizedGeometry.coordinates.length > 1 ? "relation" : "way")
				this.processPolygon(normalizedGeometry, polygonType, numericId, tags)
			} else if (normalizedGeometry.type === "MultiPolygon") {
				this.processMultiPolygon(normalizedGeometry, numericId, tags)
			} else if (normalizedGeometry.type === "MultiLineString") {
				this.processMultiLineString(normalizedGeometry, numericId, tags)
			} else {
				throw Error(`Unsupported geometry type: ${normalizedGeometry.type}`)
			}

			count++
			if (count % 10000 === 0) {
				this.onProgress(progressEvent(`Processed ${count} features...`))
			}
		}

		if (skippedInvalidGeometries > 0) {
			this.onProgress(
				progressEvent(
					`Skipped ${skippedInvalidGeometries} features with invalid geometry`,
					"warn",
				),
			)
		}
		this.onProgress(progressEvent(`Imported ${count} features`))
	}

	buildOsm() {
		this.onProgress(
			progressEvent(
				"Finished converting GeoParquet to Osmix, building indexes...",
			),
		)
		this.osm.buildIndexes()
		this.osm.buildSpatialIndexes()
		return this.osm
	}

	private nextNodeId = -1
	private nextWayId = -1
	private nextRelationId = -1
	getNextRelationId() {
		return this.nextRelationId--
	}
	getNextWayId() {
		return this.nextWayId--
	}
	getNextNodeId() {
		return this.nextNodeId--
	}

	// Map to track nodes by coordinate string for reuse when creating ways
	private nodeMap = new Map<string, number>()

	// Helper to get or create a node for a coordinate
	private getOrCreateNode(lon: number, lat: number): number {
		const coordKey = `${lon},${lat}`
		const existingNodeId = this.nodeMap.get(coordKey)
		if (existingNodeId !== undefined) {
			return existingNodeId
		}

		const nodeId = this.getNextNodeId()
		this.nodeMap.set(coordKey, nodeId)
		this.osm.nodes.addNode({
			id: nodeId,
			lon,
			lat,
		})
		return nodeId
	}

	private processPoint(
		geometry: Point,
		featureId?: number,
		tags?: OsmTags,
	): number {
		const [lon, lat] = geometry.coordinates
		if (lon === undefined || lat === undefined)
			throw Error("Point must have lon and lat coordinates")

		const nodeId = featureId ?? this.getNextNodeId()
		this.osm.nodes.addNode({
			id: nodeId,
			lon,
			lat,
			tags,
		})
		this.nodeMap.set(`${lon},${lat}`, nodeId)
		return nodeId
	}

	private processLineString(
		geometry: LineString,
		featureId?: number,
		tags?: OsmTags,
	): number {
		const coordinates = geometry.coordinates
		if (coordinates.length < 2)
			throw Error("LineString must have at least 2 coordinates")

		const nodeRefs: number[] = []
		for (const [lon, lat] of coordinates) {
			if (lon === undefined || lat === undefined)
				throw Error("LineString coordinates must have lon and lat")
			nodeRefs.push(this.getOrCreateNode(lon, lat))
		}

		if (nodeRefs.length < 2)
			throw Error("LineString must have at least 2 coordinates")

		const wayId = featureId ?? this.getNextWayId()
		this.osm.ways.addWay({
			id: wayId,
			refs: nodeRefs,
			tags,
		})

		return wayId
	}

	private processMultiLineString(
		geometry: MultiLineString,
		featureId?: number,
		tags?: OsmTags,
	) {
		const coordinates = geometry.coordinates
		if (coordinates.length === 0)
			throw Error("MultiLineString must have at least one LineString")

		const wayIds: number[] = []
		for (const line of coordinates) {
			if (line.length < 2)
				throw Error("LineString must have at least 2 coordinates")
			const wayId = this.processLineString(
				{ type: "LineString", coordinates: line },
				this.getNextWayId(),
			)
			wayIds.push(wayId)
		}

		this.osm.relations.addRelation({
			id: featureId ?? this.getNextRelationId(),
			members: wayIds.map((id) => ({ type: "way", ref: id })),
			tags: { type: "multilinestring", ...tags },
		})
	}

	private processPolygon(
		geometry: Polygon,
		type: "way" | "relation",
		featureId: number | undefined,
		tags: OsmTags | undefined,
	) {
		const coordinates = geometry.coordinates
		if (coordinates.length === 0) return

		const outerRing = coordinates[0]
		if (!outerRing || outerRing.length < 3) return

		// Create nodes for outer ring
		const outerNodeRefs: number[] = []
		for (const [lon, lat] of outerRing) {
			if (lon === undefined || lat === undefined) continue
			const nodeId = this.getOrCreateNode(lon, lat)
			outerNodeRefs.push(nodeId)
		}

		if (outerNodeRefs.length < 3) return

		// Ensure the outer ring is closed
		if (outerNodeRefs[0] !== outerNodeRefs[outerNodeRefs.length - 1]) {
			outerNodeRefs.push(outerNodeRefs[0]!)
		}

		const outerWayId =
			type === "relation"
				? this.getNextWayId()
				: (featureId ?? this.getNextWayId())
		this.osm.ways.addWay({
			id: outerWayId,
			refs: outerNodeRefs,
			tags: type === "relation" ? { area: "yes" } : { area: "yes", ...tags },
		})

		if (type === "way") return

		// Create separate ways for holes
		const holeWayIds: number[] = []
		for (let i = 1; i < coordinates.length; i++) {
			const holeRing = coordinates[i]
			if (!holeRing || holeRing.length < 3) continue

			const holeNodeRefs: number[] = []
			for (const [lon, lat] of holeRing) {
				if (lon === undefined || lat === undefined) continue
				const nodeId = this.getOrCreateNode(lon, lat)
				holeNodeRefs.push(nodeId)
			}

			if (holeNodeRefs.length < 3) continue

			// Ensure the ring is closed
			if (holeNodeRefs[0] !== holeNodeRefs[holeNodeRefs.length - 1]) {
				holeNodeRefs.push(holeNodeRefs[0]!)
			}

			const holeWayId = this.getNextWayId()
			this.osm.ways.addWay({
				id: holeWayId,
				refs: holeNodeRefs,
				tags: { area: "yes" },
			})
			holeWayIds.push(holeWayId)
		}

		this.osm.relations.addRelation({
			id: featureId ?? this.getNextRelationId(),
			members: [
				{ type: "way", ref: outerWayId, role: "outer" },
				...holeWayIds.map(
					(id) =>
						({ type: "way", ref: id, role: "inner" }) as OsmRelationMember,
				),
			],
			tags: {
				type: "multipolygon",
				...tags,
			},
		})
	}

	private processMultiPolygon(
		geometry: MultiPolygon,
		featureId: number | undefined,
		tags: OsmTags | undefined,
	) {
		const coordinates = geometry.coordinates
		if (coordinates.length === 0) return

		const relationMembers: OsmRelationMember[] = []

		for (const polygon of coordinates) {
			if (polygon.length === 0) continue

			const outerRing = polygon[0]
			if (!outerRing || outerRing.length < 3) continue

			// Create nodes for outer ring
			const outerNodeRefs: number[] = []
			for (const [lon, lat] of outerRing) {
				if (lon === undefined || lat === undefined) continue
				const nodeId = this.getOrCreateNode(lon, lat)
				outerNodeRefs.push(nodeId)
			}

			if (outerNodeRefs.length < 3) continue

			// Ensure the ring is closed
			if (outerNodeRefs[0] !== outerNodeRefs[outerNodeRefs.length - 1]) {
				outerNodeRefs.push(outerNodeRefs[0]!)
			}

			const outerWayId = this.getNextWayId()
			this.osm.ways.addWay({
				id: outerWayId,
				refs: outerNodeRefs,
				tags: { area: "yes" },
			})
			relationMembers.push({ type: "way", ref: outerWayId, role: "outer" })

			// Create separate ways for holes
			for (let i = 1; i < polygon.length; i++) {
				const holeRing = polygon[i]
				if (!holeRing || holeRing.length < 3) continue

				const holeNodeRefs: number[] = []
				for (const [lon, lat] of holeRing) {
					if (lon === undefined || lat === undefined) continue
					const nodeId = this.getOrCreateNode(lon, lat)
					holeNodeRefs.push(nodeId)
				}

				if (holeNodeRefs.length < 3) continue

				// Ensure the ring is closed
				if (holeNodeRefs[0] !== holeNodeRefs[holeNodeRefs.length - 1]) {
					holeNodeRefs.push(holeNodeRefs[0]!)
				}

				const holeWayId = this.getNextWayId()
				this.osm.ways.addWay({
					id: holeWayId,
					refs: holeNodeRefs,
					tags: { area: "yes" },
				})
				relationMembers.push({ type: "way", ref: holeWayId, role: "inner" })
			}
		}

		if (relationMembers.length > 0) {
			this.osm.relations.addRelation({
				id: featureId ?? this.getNextRelationId(),
				members: relationMembers,
				tags: { type: "multipolygon", ...tags },
			})
		}
	}
}

/**
 * Parse tags from various formats.
 */
function parseTags(
	tagsData: Record<string, string | number> | string | null | undefined,
): OsmTags | undefined {
	if (!tagsData) return undefined

	if (typeof tagsData === "string") {
		try {
			const parsed = JSON.parse(tagsData)
			if (typeof parsed === "object" && parsed !== null) {
				return parsed as OsmTags
			}
		} catch {
			return undefined
		}
	}

	if (typeof tagsData === "object") {
		const tags: OsmTags = {}
		for (const [key, value] of Object.entries(tagsData)) {
			if (typeof value === "string" || typeof value === "number") {
				tags[key] = value
			} else if (value != null) {
				tags[key] = String(value)
			}
		}
		return Object.keys(tags).length > 0 ? tags : undefined
	}

	return undefined
}

/**
 * Normalize geometry winding order for OSM conventions.
 */
function normalizeGeometry(geometry: Geometry): Geometry {
	if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
		// Use rewind to ensure correct winding order
		const feature = {
			type: "Feature" as const,
			geometry,
			properties: {},
		}
		const rewound = rewindFeature(feature)
		return rewound.geometry ?? geometry
	}
	return geometry
}
