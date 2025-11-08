import type { OsmTags } from "@osmix/json"
import type { FeatureCollection, LineString, Point } from "geojson"
import type { OsmixOptions } from "./osmix"
import { Osmix } from "./osmix"

/**
 * Convert a GeoJSON FeatureCollection into an Osmix instance.
 * Points are converted to Nodes, LineStrings are converted to Ways with Nodes.
 * Feature IDs are used if present, otherwise sequential IDs are generated.
 * All feature properties are converted to OSM tags.
 * Note: No deduplication is performed during import; this should be handled separately.
 */
export function fromGeoJSON(
	geojson: FeatureCollection<Point | LineString>,
	options: Partial<OsmixOptions> = {},
): Osmix {
	const osm = new Osmix(options)
	if (!options.id) osm.id = "geojson"

	let nextNodeId = 1
	let nextWayId = 1

	// Process each feature
	for (const feature of geojson.features) {
		const tags = propertiesToTags(feature.properties)
		const featureId = extractFeatureId(feature.id)

		if (feature.geometry.type === "Point") {
			const coords = feature.geometry.coordinates
			const lon = coords[0]
			const lat = coords[1]
			if (lon === undefined || lat === undefined) continue

			const nodeId = featureId ?? nextNodeId++
			osm.nodes.addNode({
				id: nodeId,
				lon,
				lat,
				tags,
			})
			if (featureId && featureId >= nextNodeId) {
				nextNodeId = featureId + 1
			}
		} else if (feature.geometry.type === "LineString") {
			const coordinates = feature.geometry.coordinates
			if (coordinates.length < 2) continue // Skip invalid LineStrings

			// Create nodes for each coordinate
			const nodeRefs: number[] = []
			for (const coord of coordinates) {
				const lon = coord[0]
				const lat = coord[1]
				if (lon === undefined || lat === undefined) continue

				const nodeId = nextNodeId++
				osm.nodes.addNode({
					id: nodeId,
					lon,
					lat,
				})
				nodeRefs.push(nodeId)
			}

			// Create the way
			const wayId = featureId ?? nextWayId++
			osm.ways.addWay({
				id: wayId,
				refs: nodeRefs,
				tags,
			})
			if (featureId && wayId >= nextWayId) {
				nextWayId = wayId + 1
			}
		}
	}

	// Build indexes
	osm.buildIndexes()

	// By default, build all spatial indexes (only if entities exist).
	if (!Array.isArray(options.buildSpatialIndexes)) {
		if (osm.nodes.size > 0) {
			osm.nodes.buildSpatialIndex()
		}
		if (osm.ways.size > 0) {
			osm.ways.buildSpatialIndex(osm.nodes)
		}
	} else {
		if (options.buildSpatialIndexes.includes("node") && osm.nodes.size > 0) {
			osm.nodes.buildSpatialIndex()
		}
		if (options.buildSpatialIndexes.includes("way") && osm.ways.size > 0) {
			osm.ways.buildSpatialIndex(osm.nodes)
		}
	}

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
		// Skip geometry-related properties
		if (key === "geometry" || key === "type") continue
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
