/**
 * Shapefile-to-OSM conversion utilities.
 *
 * Imports Shapefiles into Osm indexes, mapping geometry
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
import type { Feature, Polygon } from "geojson"
import {
	type Dbase,
	type DbaseVersion,
	type Shapefile,
	type ShapeMultiPoint,
	type ShapePoint,
	type ShapePolygon,
	type ShapePolyline,
	ShapeType,
} from "shapefile.js"
import type { ReadShapefileDataTypes } from "./types"
import { loadShapefileData } from "./utils"

/**
 * Create an Osm index from Shapefile data.
 *
 * Accepts various input formats (stream, buffer, or loaded Shapefile objects)
 * and converts features to OSM entities:
 * - Point → Node
 * - Polyline → Way with nodes
 * - Polygon → Way (simple) or Relation (with multiple rings)
 * - MultiPoint → Multiple Nodes
 *
 * Feature attributes from the DBF file become OSM tags.
 *
 * @param data - Shapefile data in any supported format (ZIP buffer, stream, or loaded objects).
 * @param options - Osm index options (id, header).
 * @param onProgress - Progress callback for UI feedback.
 * @returns Populated Osm index with built indexes.
 *
 * @example
 * ```ts
 * import { fromShapefile } from "@osmix/shapefile"
 *
 * // From file
 * const zipBuffer = await Bun.file('./buildings.zip').arrayBuffer()
 * const osm = await fromShapefile(zipBuffer, { id: "buildings" })
 *
 * // Query the imported data
 * const buildings = osm.ways.search("building")
 * ```
 */
export async function fromShapefile(
	data: ReadShapefileDataTypes,
	options: Partial<OsmOptions> = {},
	onProgress: (progress: ProgressEvent) => void = logProgress,
): Promise<Osm> {
	const osm = new Osm(options)
	const shapefiles = await loadShapefileData(data)

	for (const [name, shapefile] of Object.entries(shapefiles)) {
		for (const update of startCreateOsmFromShapefile(osm, shapefile, name)) {
			onProgress(update)
		}
	}

	// Build indexes after all shapefiles are processed
	onProgress(progressEvent("Building indexes..."))
	osm.buildIndexes()
	osm.buildSpatialIndexes()

	return osm
}

/**
 * Generator that converts Shapefile features to OSM entities.
 *
 * This is the core conversion logic, yielding progress events as features
 * are processed. Called by `fromShapefile` with progress handling.
 *
 * Geometry mapping:
 * - **Point**: Creates a single node with feature attributes as tags.
 * - **Polyline**: Creates nodes for each coordinate, then a way referencing them.
 * - **Polygon**: Creates a way for simple polygons; for polygons with multiple rings,
 *   creates separate ways for outer and inner rings plus a multipolygon relation.
 * - **MultiPoint**: Creates multiple nodes, one for each point.
 *
 * @param osm - Target Osm index to populate.
 * @param shapefile - Loaded Shapefile object.
 * @param name - Name of the shapefile (for progress reporting).
 * @yields Progress events during conversion.
 */
export function* startCreateOsmFromShapefile(
	osm: Osm,
	shapefile: Shapefile,
	name: string,
): Generator<ProgressEvent> {
	yield progressEvent(`Converting Shapefile "${name}" to Osmix...`)

	// Parse shape and attribute data
	const shape = shapefile.parse("shp")
	const dbf = shapefile.parse("dbf", { properties: true })

	// Map to track nodes by coordinate string for reuse when creating ways and relations
	const nodeMap = new Map<string, number>()
	let nextNodeId = osm.nodes.size > 0 ? -osm.nodes.size - 1 : -1
	let nextWayId = osm.ways.size > 0 ? -osm.ways.size - 1 : -1
	let nextRelationId = osm.relations.size > 0 ? -osm.relations.size - 1 : -1

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

	// Process each record
	let count = 0
	for (let i = 0; i < shape.records.length; i++) {
		const record = shape.records[i]
		if (!record) continue

		const tags = getRecordTags(dbf, i)
		const shapeType = record.body.type

		if (shapeType === ShapeType.Null) {
			// Skip null shapes
			continue
		}

		if (
			shapeType === ShapeType.Point ||
			shapeType === ShapeType.PointZ ||
			shapeType === ShapeType.PointM
		) {
			const point = record.body.data as ShapePoint
			const nodeId = nextNodeId--
			osm.nodes.addNode({
				id: nodeId,
				lon: point.x,
				lat: point.y,
				tags,
			})
			nodeMap.set(`${point.x},${point.y}`, nodeId)
		} else if (
			shapeType === ShapeType.MultiPoint ||
			shapeType === ShapeType.MultiPointZ ||
			shapeType === ShapeType.MultiPointM
		) {
			const multiPoint = record.body.data as ShapeMultiPoint
			for (const point of multiPoint.points) {
				const nodeId = nextNodeId--
				osm.nodes.addNode({
					id: nodeId,
					lon: point.x,
					lat: point.y,
					tags,
				})
				nodeMap.set(`${point.x},${point.y}`, nodeId)
			}
		} else if (
			shapeType === ShapeType.Polyline ||
			shapeType === ShapeType.PolylineZ ||
			shapeType === ShapeType.PolylineM
		) {
			const polyline = record.body.data as ShapePolyline
			const parts = extractParts(polyline.parts, polyline.points.length)

			for (const [startIdx, endIdx] of parts) {
				const nodeRefs: number[] = []
				for (let j = startIdx; j < endIdx; j++) {
					const point = polyline.points[j]
					if (!point) continue
					const nodeId = getOrCreateNode(point.x, point.y)
					nodeRefs.push(nodeId)
				}

				if (nodeRefs.length >= 2) {
					const wayId = nextWayId--
					osm.ways.addWay({
						id: wayId,
						refs: nodeRefs,
						tags,
					})
				}
			}
		} else if (
			shapeType === ShapeType.Polygon ||
			shapeType === ShapeType.PolygonZ ||
			shapeType === ShapeType.PolygonM
		) {
			const polygon = record.body.data as ShapePolygon
			processPolygon(
				osm,
				polygon,
				tags,
				() => nextWayId--,
				() => nextRelationId--,
				getOrCreateNode,
			)
		}

		if (++count % 1000 === 0) {
			yield progressEvent(`Processed ${count} features from "${name}"...`)
		}
	}

	yield progressEvent(`Finished converting Shapefile "${name}" to Osmix...`)
}

/**
 * Extract part indices from a shapefile parts array.
 * Returns array of [startIdx, endIdx] tuples for each part.
 */
function extractParts(
	parts: number[],
	totalPoints: number,
): [number, number][] {
	const result: [number, number][] = []
	for (let i = 0; i < parts.length; i++) {
		const startIdx = parts[i]!
		const endIdx = i < parts.length - 1 ? parts[i + 1]! : totalPoints
		result.push([startIdx, endIdx])
	}
	return result
}

/**
 * Process a shapefile polygon and add to OSM index.
 * Handles single-ring polygons as ways, multi-ring as relations.
 */
function processPolygon(
	osm: Osm,
	polygon: ShapePolygon,
	tags: OsmTags | undefined,
	getNextWayId: () => number,
	getNextRelationId: () => number,
	getOrCreateNode: (lon: number, lat: number) => number,
): void {
	const parts = extractPolygonParts(polygon)

	if (parts.length === 0) return

	// Determine outer and inner rings based on winding order
	// Shapefile spec: outer rings are clockwise, inner rings are counter-clockwise
	// We need to convert coordinates to GeoJSON format for rewind to work correctly
	const rings = parts.map((part) => {
		return part.map(([x, y]) => [x, y] as [number, number])
	})

	// Create a GeoJSON polygon for winding order normalization
	const geojsonPolygon: Feature<Polygon> = {
		type: "Feature",
		geometry: {
			type: "Polygon",
			coordinates: rings,
		},
		properties: {},
	}

	// Normalize winding order (outer ring counter-clockwise, inner rings clockwise per OSM/GeoJSON)
	const normalizedFeature = rewindFeature(geojsonPolygon)
	const normalizedGeometry = normalizedFeature.geometry as Polygon | null
	const normalizedRings = normalizedGeometry?.coordinates || []

	if (normalizedRings.length === 0) return

	const createRelation = normalizedRings.length > 1

	// First ring is outer boundary
	const outerRing = normalizedRings[0]
	if (!outerRing || outerRing.length < 3) return

	// Create nodes for outer ring
	const outerNodeRefs: number[] = []
	for (const [lon, lat] of outerRing) {
		if (lon === undefined || lat === undefined) continue
		const nodeId = getOrCreateNode(lon, lat)
		outerNodeRefs.push(nodeId)
	}

	// Ensure ring is closed
	if (outerNodeRefs.length < 3) return
	if (outerNodeRefs[0] !== outerNodeRefs[outerNodeRefs.length - 1]) {
		outerNodeRefs.push(outerNodeRefs[0]!)
	}

	// Create way for outer ring
	const outerWayId = getNextWayId()
	osm.ways.addWay({
		id: outerWayId,
		refs: outerNodeRefs,
		tags: createRelation ? { area: "yes" } : { area: "yes", ...tags },
	})

	// Create separate ways for holes
	const holeWayIds: number[] = []
	for (let i = 1; i < normalizedRings.length; i++) {
		const holeRing = normalizedRings[i]
		if (!holeRing || holeRing.length < 3) continue

		const holeNodeRefs: number[] = []
		for (const [lon, lat] of holeRing) {
			if (lon === undefined || lat === undefined) continue
			const nodeId = getOrCreateNode(lon, lat)
			holeNodeRefs.push(nodeId)
		}

		if (holeNodeRefs.length < 3) continue
		// Ensure hole ring is closed
		if (holeNodeRefs[0] !== holeNodeRefs[holeNodeRefs.length - 1]) {
			holeNodeRefs.push(holeNodeRefs[0]!)
		}

		const holeWayId = getNextWayId()
		osm.ways.addWay({
			id: holeWayId,
			refs: holeNodeRefs,
			tags: { area: "yes" },
		})
		holeWayIds.push(holeWayId)
	}

	if (createRelation) {
		osm.relations.addRelation({
			id: getNextRelationId(),
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
}

/**
 * Extract polygon parts as coordinate arrays.
 * Returns array of coordinate arrays, one for each ring.
 */
function extractPolygonParts(polygon: ShapePolygon): [number, number][][] {
	const result: [number, number][][] = []
	const parts = extractParts(polygon.parts, polygon.numberOfPoints)

	for (const [startIdx, endIdx] of parts) {
		const ring: [number, number][] = []
		for (let i = startIdx; i < endIdx; i++) {
			// Polygon points are stored as a flat array: [x1, y1, x2, y2, ...]
			const x = polygon.points[i * 2]
			const y = polygon.points[i * 2 + 1]
			if (x !== undefined && y !== undefined) {
				ring.push([x, y])
			}
		}
		if (ring.length >= 3) {
			result.push(ring)
		}
	}

	return result
}

/**
 * Get OSM tags from DBF record at given index.
 */
function getRecordTags(
	dbf: Dbase<DbaseVersion, true>,
	recordIndex: number,
): OsmTags | undefined {
	if (!dbf.fields || dbf.fields.length === 0) return undefined

	const tags: OsmTags = {}

	for (const field of dbf.fields) {
		if (!field.properties || recordIndex >= field.properties.length) continue

		const value = field.properties[recordIndex]
		if (value == null) continue

		const key = field.name.trim()
		if (!key) continue

		// Convert value to string or number
		if (typeof value === "string") {
			const trimmed = value.trim()
			if (trimmed) tags[key] = trimmed
		} else if (typeof value === "number") {
			tags[key] = value
		} else if (typeof value === "boolean") {
			tags[key] = String(value)
		} else {
			tags[key] = String(value)
		}
	}

	return Object.keys(tags).length > 0 ? tags : undefined
}
