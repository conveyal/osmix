import {
	isNode,
	isRelation,
	isWay,
	nodeToFeature,
	type OsmEntity,
	type OsmixGeoJSONFeature,
	type OsmRelationMember,
	type OsmTags,
	relationToFeature,
	wayToFeature,
} from "@osmix/json"
import rewind from "@osmix/shared/geojson-rewind"
import type {
	FeatureCollection,
	LineString,
	MultiPolygon,
	Point,
	Polygon,
} from "geojson"
import type { OsmixOptions } from "./osmix"
import { Osmix } from "./osmix"
import { throttle } from "./utils"

interface OsmixCreateFromGeoJSONOptions extends OsmixOptions {
	logger: (message: string) => void
}

/**
 * Convert a GeoJSON FeatureCollection into an Osmix instance.
 * Points are converted to Nodes, LineStrings are converted to Ways with Nodes.
 * Polygons are converted to Ways with area tags (outer ring) and separate ways for holes.
 * MultiPolygons are converted to multiple ways or relations.
 * Feature IDs are used if present, otherwise sequential IDs are generated.
 * All feature properties are converted to OSM tags.
 */
export function fromGeoJSON(
	geojson: FeatureCollection<Point | LineString | Polygon | MultiPolygon>,
	options: Partial<OsmixCreateFromGeoJSONOptions> = {},
): Osmix {
	const osm = new Osmix(options)
	if (!options.id) osm.id = "geojson"
	const log = options.logger ?? ((...msg) => console.log(...msg))

	log("Converting GeoJSON to Osmix...")
	const logEverySecond = throttle(log, 1_000)

	// Map to track nodes by coordinate string for reuse when creating ways and relations
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

	// Process each feature
	let count = 0
	for (const feature of geojson.features) {
		logEverySecond(`Processed ${count++} features...`)
		// Normalize winding order using rewind (outer rings counterclockwise, inner rings clockwise)
		const normalizedFeature = rewind(feature, false)
		const tags = propertiesToTags(normalizedFeature.properties)
		const featureId = extractFeatureId(normalizedFeature.id)

		if (normalizedFeature.geometry.type === "Point") {
			const [lon, lat] = normalizedFeature.geometry.coordinates
			if (lon === undefined || lat === undefined)
				throw Error("Invalid GeoJSON coordinates in Point.")

			const nodeId = featureId ?? nextNodeId--
			osm.nodes.addNode({
				id: nodeId,
				lon,
				lat,
				tags,
			})
			nodeMap.set(`${lon},${lat}`, nodeId)
		} else if (normalizedFeature.geometry.type === "LineString") {
			const coordinates = normalizedFeature.geometry.coordinates
			if (coordinates.length < 2)
				throw Error("Invalid GeoJSON coordinates in LineString.")

			// Create or get nodes for each coordinate
			const nodeRefs: number[] = []
			for (const [lon, lat] of coordinates) {
				if (lon === undefined || lat === undefined)
					throw Error("Invalid GeoJSON coordinates in LineString.")
				const nodeId = getOrCreateNode(lon, lat)
				nodeRefs.push(nodeId)
			}

			// Create the way
			const wayId = featureId ?? nextWayId--
			osm.ways.addWay({
				id: wayId,
				refs: nodeRefs,
				tags,
			})
		} else if (normalizedFeature.geometry.type === "Polygon") {
			const coordinates = normalizedFeature.geometry.coordinates
			if (coordinates.length === 0) continue

			// If the polygon contains holes, create a relation
			const createRelation = coordinates.length > 1

			// First ring is outer boundary, subsequent rings are holes
			const outerRing = coordinates[0]
			if (!outerRing || outerRing.length < 3) continue // Need at least 3 points for a polygon

			// Create nodes for outer ring
			const outerNodeRefs: number[] = []
			for (const [lon, lat] of outerRing) {
				if (lon === undefined || lat === undefined)
					throw Error("Invalid GeoJSON coordinates in Polygon.")
				const nodeId = getOrCreateNode(lon, lat)
				outerNodeRefs.push(nodeId)
			}

			// Ensure the outer ring is closed (first and last node are the same)
			if (outerNodeRefs[0] !== outerNodeRefs[outerNodeRefs.length - 1])
				throw Error("Outer ring of Polygon is not closed.")

			// Create way for outer ring with area tags
			const outerWayId = createRelation
				? nextWayId--
				: (featureId ?? nextWayId--)
			osm.ways.addWay({
				id: outerWayId,
				refs: outerNodeRefs,
				tags: createRelation ? { area: "yes" } : { area: "yes", ...tags },
			})

			// Create separate ways for holes
			const holeWayIds: number[] = []
			for (let i = 1; i < coordinates.length; i++) {
				const holeRing = coordinates[i]
				if (!holeRing || holeRing.length < 3)
					throw Error("Hole ring of Polygon has less than 3 coordinates.")

				const holeNodeRefs: number[] = []
				for (const [lon, lat] of holeRing) {
					if (lon === undefined || lat === undefined)
						throw Error("Invalid GeoJSON coordinates in Polygon.")
					const nodeId = getOrCreateNode(lon, lat)
					holeNodeRefs.push(nodeId)
				}

				// Ensure the ring is closed
				if (holeNodeRefs[0] !== holeNodeRefs[holeNodeRefs.length - 1])
					throw Error("Hole ring of Polygon is not closed.")

				// Create way for hole
				const holeWayId = nextWayId--
				osm.ways.addWay({
					id: holeWayId,
					refs: holeNodeRefs,
					tags: { area: "yes" },
				})
				holeWayIds.push(holeWayId)
			}

			if (createRelation) {
				osm.relations.addRelation({
					id: featureId ?? nextRelationId--,
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
		} else if (normalizedFeature.geometry.type === "MultiPolygon") {
			const coordinates = normalizedFeature.geometry.coordinates
			if (coordinates.length === 0) continue

			// Process each polygon in the MultiPolygon
			const relationMembers: OsmRelationMember[] = []
			for (const polygon of coordinates) {
				if (polygon.length === 0) continue

				const outerRing = polygon[0]
				if (!outerRing || outerRing.length < 3) continue

				// Create nodes for outer ring
				const outerNodeRefs: number[] = []
				for (const [lon, lat] of outerRing) {
					if (lon === undefined || lat === undefined)
						throw Error("Invalid GeoJSON coordinates in Polygon.")
					const nodeId = getOrCreateNode(lon, lat)
					outerNodeRefs.push(nodeId)
				}

				// Ensure the ring is closed
				if (outerNodeRefs[0] !== outerNodeRefs[outerNodeRefs.length - 1])
					throw Error("Outer ring of Polygon is not closed.")

				// Create way for outer ring
				const outerWayId = nextWayId--
				osm.ways.addWay({
					id: outerWayId,
					refs: outerNodeRefs,
					tags: { area: "yes" },
				})
				relationMembers.push({ type: "way", ref: outerWayId, role: "outer" })

				// Create separate ways for holes in this polygon
				for (let i = 1; i < polygon.length; i++) {
					const holeRing = polygon[i]
					if (!holeRing || holeRing.length < 3)
						throw Error("Hole ring of Polygon has less than 3 coordinates.")

					const holeNodeRefs: number[] = []
					for (const [lon, lat] of holeRing) {
						if (lon === undefined || lat === undefined)
							throw Error("Invalid GeoJSON coordinates in Polygon.")
						const nodeId = getOrCreateNode(lon, lat)
						holeNodeRefs.push(nodeId)
					}

					// Ensure the ring is closed
					if (holeNodeRefs[0] !== holeNodeRefs[holeNodeRefs.length - 1])
						throw Error("Hole ring of Polygon is not closed.")

					const holeWayId = nextWayId--
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
					id: featureId ?? nextRelationId--,
					members: relationMembers,
					tags: { type: "multipolygon", ...tags },
				})
			}
		}
	}

	log("Finished converting GeoJSON to Osmix, building indexes...")

	// Build indexes
	osm.buildIndexes()
	osm.buildSpatialIndexes()

	return osm
}

// Helper to convert properties to tags
function propertiesToTags(
	properties: Record<string, unknown> | null,
): OsmTags | undefined {
	if (!properties || Object.keys(properties).length === 0) {
		return undefined
	}

	const tags: OsmTags = {}
	for (const [key, value] of Object.entries(properties)) {
		// Convert value to string or number
		if (typeof value === "string" || typeof value === "number") {
			tags[key] = value
		} else if (value != null) {
			// Convert other types to string
			tags[key] = String(value)
		}
	}
	return Object.keys(tags).length > 0 ? tags : undefined
}

// Helper to extract numeric ID from feature
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

/**
 * Helper to convert an Osmix entity to a GeoJSON feature.
 */
export function osmixEntityToGeoJSONFeature(
	osmix: Osmix,
	entity: OsmEntity,
): OsmixGeoJSONFeature<
	GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon | GeoJSON.MultiPolygon
> {
	if (isNode(entity)) {
		return nodeToFeature(entity)
	}
	if (isWay(entity)) {
		return wayToFeature(entity, (ref) => osmix.nodes.getNodeLonLat({ id: ref }))
	}
	if (isRelation(entity)) {
		return relationToFeature(
			entity,
			(ref) => osmix.nodes.getNodeLonLat({ id: ref }),
			(ref) => osmix.ways.getById(ref),
		)
	}
	throw new Error("Unknown entity type")
}
