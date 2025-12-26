/**
 * Layercake GeoParquet to OSM conversion utilities.
 *
 * Imports Layercake GeoParquet files into Osm indexes, mapping geometry
 * types to appropriate OSM entity structures.
 *
 * @module
 */

import { Osm, type OsmOptions } from "@osmix/core"
import { rewindFeature } from "@placemarkio/geojson-rewind"
import {
	logProgress,
	type ProgressEvent,
	progressEvent,
} from "@osmix/shared/progress"
import type { OsmRelationMember, OsmTags } from "@osmix/shared/types"
import type {
	Geometry,
	LineString,
	MultiPolygon,
	Point,
	Polygon,
} from "geojson"
import type {
	LayerCakeReadOptions,
	LayerCakeRow,
	LayerCakeSource,
} from "./types"
import { parseWkb } from "./wkb"

/**
 * Create an Osm index from Layercake GeoParquet data.
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
 * @param source - Layercake data source (file path, URL, or buffer)
 * @param options - Osm index options (id, header)
 * @param readOptions - Options for reading the parquet file
 * @param onProgress - Progress callback for UI feedback
 * @returns Populated Osm index with built indexes
 *
 * @example
 * ```ts
 * import { fromLayerCake } from "@osmix/layercake"
 *
 * // From file
 * const osm = await fromLayerCake("./roads.parquet", { id: "roads" })
 *
 * // Query the imported data
 * const highways = osm.ways.search("highway")
 * ```
 */
export async function fromLayerCake(
	source: LayerCakeSource,
	options: Partial<OsmOptions> = {},
	readOptions: LayerCakeReadOptions = {},
	onProgress: (progress: ProgressEvent) => void = logProgress,
): Promise<Osm> {
	const osm = new Osm(options)

	onProgress(progressEvent("Loading Layercake GeoParquet file..."))

	// Dynamically import hyparquet to work with both browser and Node.js
	const { parquetReadObjects, asyncBufferFromUrl } = await import("hyparquet")

	// Read rows from parquet file
	const rows = await readParquetRows(
		source,
		readOptions,
		parquetReadObjects,
		asyncBufferFromUrl,
		onProgress,
	)

	onProgress(progressEvent(`Processing ${rows.length} features...`))

	// Convert to OSM entities
	for (const update of processLayerCakeRows(osm, rows, readOptions)) {
		onProgress(update)
	}

	return osm
}

/**
 * Read rows from a parquet file.
 */
async function readParquetRows(
	source: LayerCakeSource,
	readOptions: LayerCakeReadOptions,
	// biome-ignore lint/suspicious/noExplicitAny: hyparquet types
	parquetReadObjects: any,
	// biome-ignore lint/suspicious/noExplicitAny: hyparquet types
	asyncBufferFromUrl: any,
	onProgress: (progress: ProgressEvent) => void,
): Promise<LayerCakeRow[]> {
	const idColumn = readOptions.idColumn ?? "id"
	const geometryColumn = readOptions.geometryColumn ?? "geometry"
	const tagsColumn = readOptions.tagsColumn ?? "tags"

	let file: unknown

	if (typeof source === "string") {
		// Check if it's a URL or file path
		if (source.startsWith("http://") || source.startsWith("https://")) {
			onProgress(progressEvent(`Fetching from URL: ${source}`))
			file = await asyncBufferFromUrl({ url: source })
		} else {
			// Node.js/Bun file path - use fs to read the file
			const { readFileSync } = await import("node:fs")
			const buffer = readFileSync(source)
			const arrayBuffer = buffer.buffer.slice(
				buffer.byteOffset,
				buffer.byteOffset + buffer.byteLength,
			)
			file = {
				byteLength: arrayBuffer.byteLength,
				slice: (start: number, end?: number) => arrayBuffer.slice(start, end),
			}
		}
	} else if (source instanceof URL) {
		onProgress(progressEvent(`Fetching from URL: ${source.href}`))
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

	const columns = [idColumn, geometryColumn, tagsColumn]
	const readConfig: {
		file: unknown
		columns: string[]
		rowEnd?: number
	} = {
		file,
		columns,
	}

	if (readOptions.maxRows !== undefined) {
		readConfig.rowEnd = readOptions.maxRows
	}

	onProgress(progressEvent("Reading parquet data..."))
	const rows = (await parquetReadObjects(readConfig)) as LayerCakeRow[]

	return rows
}

/**
 * Generator that converts Layercake rows to OSM entities.
 */
export function* processLayerCakeRows(
	osm: Osm,
	rows: LayerCakeRow[],
	readOptions: LayerCakeReadOptions = {},
): Generator<ProgressEvent> {
	yield progressEvent("Converting Layercake to Osmix...")

	const idColumn = readOptions.idColumn ?? "id"
	const geometryColumn = readOptions.geometryColumn ?? "geometry"
	const tagsColumn = readOptions.tagsColumn ?? "tags"

	// Map to track nodes by coordinate string for reuse when creating ways
	const nodeMap = new Map<string, number>()
	let nextNodeId = -1
	let nextWayId = -1
	let nextRelationId = -1

	// Helper to get or create a node for a coordinate
	const getOrCreateNode = (lon: number, lat: number): number => {
		const coordKey = `${lon},${lat}`
		const existingNodeId = nodeMap.get(coordKey)
		if (existingNodeId !== undefined) {
			return existingNodeId
		}

		const nodeId = nextNodeId--
		nodeMap.set(coordKey, nodeId)
		osm.nodes.addNode({
			id: nodeId,
			lon,
			lat,
		})
		return nodeId
	}

	// Process each row
	let count = 0
	for (const row of rows) {
		// Extract values using column names
		// biome-ignore lint/suspicious/noExplicitAny: dynamic column access
		const rowAny = row as any
		const id = rowAny[idColumn] as bigint | number | undefined
		const geometryData = rowAny[geometryColumn] as Uint8Array | undefined
		const tagsData = rowAny[tagsColumn] as
			| Record<string, string | number>
			| string
			| null
			| undefined

		if (!geometryData) {
			count++
			continue
		}

		// Parse WKB geometry
		let geometry: Geometry
		try {
			geometry = parseWkb(geometryData)
		} catch (_e) {
			// Skip invalid geometries
			count++
			continue
		}

		// Parse tags
		const tags = parseTags(tagsData)

		// Get numeric ID from bigint or generate one
		const numericId =
			id !== undefined ? (typeof id === "bigint" ? Number(id) : id) : undefined

		// Normalize geometry winding order
		const normalizedGeometry = normalizeGeometry(geometry)

		if (normalizedGeometry.type === "Point") {
			processPoint(
				osm,
				normalizedGeometry,
				numericId,
				tags,
				nodeMap,
				() => nextNodeId--,
			)
		} else if (normalizedGeometry.type === "LineString") {
			processLineString(
				osm,
				normalizedGeometry,
				numericId,
				tags,
				getOrCreateNode,
				() => nextWayId--,
			)
		} else if (normalizedGeometry.type === "Polygon") {
			const ids = processPolygon(
				osm,
				normalizedGeometry,
				numericId,
				tags,
				getOrCreateNode,
				() => nextWayId--,
				() => nextRelationId--,
			)
			nextWayId = ids.nextWayId
			nextRelationId = ids.nextRelationId
		} else if (normalizedGeometry.type === "MultiPolygon") {
			const ids = processMultiPolygon(
				osm,
				normalizedGeometry,
				numericId,
				tags,
				getOrCreateNode,
				() => nextWayId--,
				() => nextRelationId--,
			)
			nextWayId = ids.nextWayId
			nextRelationId = ids.nextRelationId
		} else if (normalizedGeometry.type === "MultiLineString") {
			for (const line of normalizedGeometry.coordinates) {
				const lineGeometry: LineString = {
					type: "LineString",
					coordinates: line,
				}
				processLineString(
					osm,
					lineGeometry,
					undefined,
					tags,
					getOrCreateNode,
					() => nextWayId--,
				)
				nextWayId--
			}
		} else if (normalizedGeometry.type === "MultiPoint") {
			for (const point of normalizedGeometry.coordinates) {
				const pointGeometry: Point = { type: "Point", coordinates: point }
				processPoint(
					osm,
					pointGeometry,
					undefined,
					undefined,
					nodeMap,
					() => nextNodeId--,
				)
				nextNodeId--
			}
		}

		count++
		if (count % 10000 === 0) {
			yield progressEvent(`Processed ${count} features...`)
		}
	}

	yield progressEvent(
		"Finished converting Layercake to Osmix, building indexes...",
	)

	// Build indexes
	osm.buildIndexes()
	osm.buildSpatialIndexes()

	yield progressEvent(`Imported ${count} features`)
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

function processPoint(
	osm: Osm,
	geometry: Point,
	featureId: number | undefined,
	tags: OsmTags | undefined,
	nodeMap: Map<string, number>,
	getNextNodeId: () => number,
): void {
	const [lon, lat] = geometry.coordinates
	if (lon === undefined || lat === undefined) return

	const nodeId = featureId ?? getNextNodeId()
	osm.nodes.addNode({
		id: nodeId,
		lon,
		lat,
		tags,
	})
	nodeMap.set(`${lon},${lat}`, nodeId)
}

function processLineString(
	osm: Osm,
	geometry: LineString,
	featureId: number | undefined,
	tags: OsmTags | undefined,
	getOrCreateNode: (lon: number, lat: number) => number,
	getNextWayId: () => number,
): void {
	const coordinates = geometry.coordinates
	if (coordinates.length < 2) return

	const nodeRefs: number[] = []
	for (const [lon, lat] of coordinates) {
		if (lon === undefined || lat === undefined) continue
		const nodeId = getOrCreateNode(lon, lat)
		nodeRefs.push(nodeId)
	}

	if (nodeRefs.length < 2) return

	const wayId = featureId ?? getNextWayId()
	osm.ways.addWay({
		id: wayId,
		refs: nodeRefs,
		tags,
	})
}

function processPolygon(
	osm: Osm,
	geometry: Polygon,
	featureId: number | undefined,
	tags: OsmTags | undefined,
	getOrCreateNode: (lon: number, lat: number) => number,
	getNextWayId: () => number,
	getNextRelationId: () => number,
): { nextWayId: number; nextRelationId: number } {
	const coordinates = geometry.coordinates
	if (coordinates.length === 0)
		return {
			nextWayId: getNextWayId() + 1,
			nextRelationId: getNextRelationId() + 1,
		}

	const createRelation = coordinates.length > 1
	const outerRing = coordinates[0]
	if (!outerRing || outerRing.length < 3)
		return {
			nextWayId: getNextWayId() + 1,
			nextRelationId: getNextRelationId() + 1,
		}

	let currentWayId = getNextWayId()
	let currentRelationId = getNextRelationId()

	// Create nodes for outer ring
	const outerNodeRefs: number[] = []
	for (const [lon, lat] of outerRing) {
		if (lon === undefined || lat === undefined) continue
		const nodeId = getOrCreateNode(lon, lat)
		outerNodeRefs.push(nodeId)
	}

	if (outerNodeRefs.length < 3)
		return { nextWayId: currentWayId, nextRelationId: currentRelationId }

	// Ensure the outer ring is closed
	if (outerNodeRefs[0] !== outerNodeRefs[outerNodeRefs.length - 1]) {
		outerNodeRefs.push(outerNodeRefs[0]!)
	}

	const outerWayId = createRelation
		? currentWayId--
		: (featureId ?? currentWayId--)
	osm.ways.addWay({
		id: outerWayId,
		refs: outerNodeRefs,
		tags: createRelation ? { area: "yes" } : { area: "yes", ...tags },
	})

	// Create separate ways for holes
	const holeWayIds: number[] = []
	for (let i = 1; i < coordinates.length; i++) {
		const holeRing = coordinates[i]
		if (!holeRing || holeRing.length < 3) continue

		const holeNodeRefs: number[] = []
		for (const [lon, lat] of holeRing) {
			if (lon === undefined || lat === undefined) continue
			const nodeId = getOrCreateNode(lon, lat)
			holeNodeRefs.push(nodeId)
		}

		if (holeNodeRefs.length < 3) continue

		// Ensure the ring is closed
		if (holeNodeRefs[0] !== holeNodeRefs[holeNodeRefs.length - 1]) {
			holeNodeRefs.push(holeNodeRefs[0]!)
		}

		const holeWayId = currentWayId--
		osm.ways.addWay({
			id: holeWayId,
			refs: holeNodeRefs,
			tags: { area: "yes" },
		})
		holeWayIds.push(holeWayId)
	}

	if (createRelation) {
		osm.relations.addRelation({
			id: featureId ?? currentRelationId--,
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

	return { nextWayId: currentWayId, nextRelationId: currentRelationId }
}

function processMultiPolygon(
	osm: Osm,
	geometry: MultiPolygon,
	featureId: number | undefined,
	tags: OsmTags | undefined,
	getOrCreateNode: (lon: number, lat: number) => number,
	getNextWayId: () => number,
	getNextRelationId: () => number,
): { nextWayId: number; nextRelationId: number } {
	const coordinates = geometry.coordinates
	if (coordinates.length === 0)
		return {
			nextWayId: getNextWayId() + 1,
			nextRelationId: getNextRelationId() + 1,
		}

	let currentWayId = getNextWayId()
	let currentRelationId = getNextRelationId()

	const relationMembers: OsmRelationMember[] = []

	for (const polygon of coordinates) {
		if (polygon.length === 0) continue

		const outerRing = polygon[0]
		if (!outerRing || outerRing.length < 3) continue

		// Create nodes for outer ring
		const outerNodeRefs: number[] = []
		for (const [lon, lat] of outerRing) {
			if (lon === undefined || lat === undefined) continue
			const nodeId = getOrCreateNode(lon, lat)
			outerNodeRefs.push(nodeId)
		}

		if (outerNodeRefs.length < 3) continue

		// Ensure the ring is closed
		if (outerNodeRefs[0] !== outerNodeRefs[outerNodeRefs.length - 1]) {
			outerNodeRefs.push(outerNodeRefs[0]!)
		}

		const outerWayId = currentWayId--
		osm.ways.addWay({
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
				const nodeId = getOrCreateNode(lon, lat)
				holeNodeRefs.push(nodeId)
			}

			if (holeNodeRefs.length < 3) continue

			// Ensure the ring is closed
			if (holeNodeRefs[0] !== holeNodeRefs[holeNodeRefs.length - 1]) {
				holeNodeRefs.push(holeNodeRefs[0]!)
			}

			const holeWayId = currentWayId--
			osm.ways.addWay({
				id: holeWayId,
				refs: holeNodeRefs,
				tags: { area: "yes" },
			})
			relationMembers.push({ type: "way", ref: holeWayId, role: "inner" })
		}
	}

	if (relationMembers.length > 0) {
		osm.relations.addRelation({
			id: featureId ?? currentRelationId--,
			members: relationMembers,
			tags: { type: "multipolygon", ...tags },
		})
	}

	return { nextWayId: currentWayId, nextRelationId: currentRelationId }
}
