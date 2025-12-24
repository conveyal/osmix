/**
 * Shapefile-to-OSM conversion utilities.
 *
 * Imports Shapefiles into Osm indexes by first parsing them to GeoJSON
 * using shpjs, then converting the GeoJSON to OSM entities.
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
	Feature,
	FeatureCollection,
	LineString,
	MultiPolygon,
	Point,
	Polygon,
} from "geojson"
import type { ReadShapefileDataTypes } from "./types"
import { parseShapefile } from "./utils"

/**
 * Create an Osm index from Shapefile data.
 *
 * Parses Shapefiles using shpjs (which returns GeoJSON) and converts
 * the features to OSM entities:
 * - Point → Node
 * - LineString/MultiLineString → Way(s) with nodes
 * - Polygon → Way (simple) or Relation (with holes)
 * - MultiPolygon → Relation
 *
 * Feature properties become OSM tags.
 *
 * @param data - Shapefile data (URL string or ArrayBuffer of ZIP).
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
 * // From URL
 * const osm = await fromShapefile('https://example.com/data.zip')
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

	onProgress(progressEvent("Parsing Shapefile..."))
	const collections = await parseShapefile(data)

	for (const collection of collections) {
		const name = collection.fileName ?? "shapefile"
		for (const update of startCreateOsmFromShapefile(osm, collection, name)) {
			onProgress(update)
		}
	}

	// Build indexes after all collections are processed
	onProgress(progressEvent("Building indexes..."))
	osm.buildIndexes()
	osm.buildSpatialIndexes()

	return osm
}

/**
 * Generator that converts GeoJSON features from a shapefile to OSM entities.
 *
 * This is the core conversion logic, yielding progress events as features
 * are processed.
 *
 * Geometry mapping:
 * - **Point**: Creates a single node with feature properties as tags.
 * - **MultiPoint**: Creates multiple nodes.
 * - **LineString**: Creates nodes for each coordinate, then a way referencing them.
 * - **MultiLineString**: Creates multiple ways.
 * - **Polygon**: Creates a way for simple polygons; for polygons with holes,
 *   creates separate ways for outer and inner rings plus a multipolygon relation.
 * - **MultiPolygon**: Creates a multipolygon relation with all rings as way members.
 *
 * @param osm - Target Osm index to populate.
 * @param geojson - Parsed GeoJSON FeatureCollection from shapefile.
 * @param name - Name for progress reporting.
 * @yields Progress events during conversion.
 */
export function* startCreateOsmFromShapefile(
	osm: Osm,
	geojson: FeatureCollection,
	name: string,
): Generator<ProgressEvent> {
	yield progressEvent(`Converting "${name}" to Osmix...`)

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

	// Process each feature
	let count = 0
	for (const feature of geojson.features) {
		const geometry = feature.geometry
		if (!geometry) continue

		// Normalize winding order for polygons
		const normalizedFeature =
			geometry.type === "Polygon" || geometry.type === "MultiPolygon"
				? rewindFeature(feature as Feature<Polygon | MultiPolygon>)
				: feature

		const tags = propertiesToTags(normalizedFeature.properties)
		const featureId = extractFeatureId(normalizedFeature.id)

		const geomType = normalizedFeature.geometry?.type

		if (geomType === "Point") {
			const coords = (normalizedFeature.geometry as Point).coordinates
			const [lon, lat] = coords
			if (lon === undefined || lat === undefined) continue

			const nodeId = featureId ?? nextNodeId--
			osm.nodes.addNode({
				id: nodeId,
				lon,
				lat,
				tags,
			})
			nodeMap.set(`${lon},${lat}`, nodeId)
		} else if (geomType === "MultiPoint") {
			const coords = (normalizedFeature.geometry as GeoJSON.MultiPoint)
				.coordinates
			for (const [lon, lat] of coords) {
				if (lon === undefined || lat === undefined) continue
				const nodeId = nextNodeId--
				osm.nodes.addNode({
					id: nodeId,
					lon,
					lat,
					tags,
				})
				nodeMap.set(`${lon},${lat}`, nodeId)
			}
		} else if (geomType === "LineString") {
			const coords = (normalizedFeature.geometry as LineString).coordinates
			if (coords.length < 2) continue

			const nodeRefs: number[] = []
			for (const [lon, lat] of coords) {
				if (lon === undefined || lat === undefined) continue
				const nodeId = getOrCreateNode(lon, lat)
				nodeRefs.push(nodeId)
			}

			if (nodeRefs.length >= 2) {
				const wayId = featureId ?? nextWayId--
				osm.ways.addWay({
					id: wayId,
					refs: nodeRefs,
					tags,
				})
			}
		} else if (geomType === "MultiLineString") {
			const coords = (normalizedFeature.geometry as GeoJSON.MultiLineString)
				.coordinates
			for (const line of coords) {
				if (line.length < 2) continue

				const nodeRefs: number[] = []
				for (const [lon, lat] of line) {
					if (lon === undefined || lat === undefined) continue
					const nodeId = getOrCreateNode(lon, lat)
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
		} else if (geomType === "Polygon") {
			const coords = (normalizedFeature.geometry as Polygon).coordinates
			processPolygonRings(
				osm,
				coords,
				tags,
				featureId,
				() => nextWayId--,
				() => nextRelationId--,
				getOrCreateNode,
			)
		} else if (geomType === "MultiPolygon") {
			const coords = (normalizedFeature.geometry as MultiPolygon).coordinates
			const relationMembers: OsmRelationMember[] = []

			for (const polygon of coords) {
				const { outerWayId, holeWayIds } = processPolygonRings(
					osm,
					polygon,
					undefined, // Tags go on relation
					undefined,
					() => nextWayId--,
					() => nextRelationId--,
					getOrCreateNode,
				)

				if (outerWayId !== undefined) {
					relationMembers.push({ type: "way", ref: outerWayId, role: "outer" })
					for (const holeId of holeWayIds) {
						relationMembers.push({ type: "way", ref: holeId, role: "inner" })
					}
				}
			}

			if (relationMembers.length > 0) {
				osm.relations.addRelation({
					id: featureId ?? nextRelationId--,
					members: relationMembers,
					tags: { type: "multipolygon", ...tags },
				})
			}
		}

		if (++count % 1000 === 0) {
			yield progressEvent(`Processed ${count} features from "${name}"...`)
		}
	}

	yield progressEvent(`Finished converting "${name}" to Osmix...`)
}

/**
 * Process polygon rings and add to OSM index.
 * Returns the created way IDs for use in multipolygon relations.
 */
function processPolygonRings(
	osm: Osm,
	coordinates: number[][][],
	tags: OsmTags | undefined,
	featureId: number | undefined,
	getNextWayId: () => number,
	getNextRelationId: () => number,
	getOrCreateNode: (lon: number, lat: number) => number,
): { outerWayId: number | undefined; holeWayIds: number[] } {
	if (coordinates.length === 0) {
		return { outerWayId: undefined, holeWayIds: [] }
	}

	const outerRing = coordinates[0]
	if (!outerRing || outerRing.length < 3) {
		return { outerWayId: undefined, holeWayIds: [] }
	}

	const createRelation = coordinates.length > 1

	// Create nodes for outer ring
	const outerNodeRefs: number[] = []
	for (const coord of outerRing) {
		const [lon, lat] = coord
		if (lon === undefined || lat === undefined) continue
		const nodeId = getOrCreateNode(lon, lat)
		outerNodeRefs.push(nodeId)
	}

	if (outerNodeRefs.length < 3) {
		return { outerWayId: undefined, holeWayIds: [] }
	}

	// Ensure ring is closed
	if (outerNodeRefs[0] !== outerNodeRefs[outerNodeRefs.length - 1]) {
		outerNodeRefs.push(outerNodeRefs[0]!)
	}

	// Create way for outer ring
	const outerWayId = createRelation
		? getNextWayId()
		: (featureId ?? getNextWayId())
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
		for (const coord of holeRing) {
			const [lon, lat] = coord
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
			id: featureId ?? getNextRelationId(),
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

	return { outerWayId, holeWayIds }
}

/**
 * Convert GeoJSON properties to OSM tags.
 */
function propertiesToTags(
	properties: Record<string, unknown> | null,
): OsmTags | undefined {
	if (!properties || Object.keys(properties).length === 0) {
		return undefined
	}

	const tags: OsmTags = {}
	for (const [key, value] of Object.entries(properties)) {
		if (typeof value === "string" || typeof value === "number") {
			tags[key] = value
		} else if (value != null) {
			tags[key] = String(value)
		}
	}
	return Object.keys(tags).length > 0 ? tags : undefined
}

/**
 * Extract numeric ID from feature.
 */
function extractFeatureId(
	featureId: string | number | undefined,
): number | undefined {
	if (featureId === undefined) return undefined
	if (typeof featureId === "number") return featureId
	if (typeof featureId === "string") {
		const numId = Number.parseInt(featureId, 10)
		if (!Number.isNaN(numId)) return numId
	}
	return undefined
}
