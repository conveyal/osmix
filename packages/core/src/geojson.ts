import type { OsmNode, OsmTags } from "@osmix/json"
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
	options: Partial<OsmixOptions> = {},
): Osmix {
	const osm = new Osmix(options)
	if (!options.id) osm.id = "geojson"

	// Map to track nodes by coordinate string for reuse
	const nodeMap = new Map<string, number>()
	// Set to track used node IDs (for checking duplicates)
	const usedNodeIds = new Set<number>()
	// Set to track used way IDs (for checking duplicates)
	const usedWayIds = new Set<number>()
	let nextNodeId = 1
	let nextWayId = 1

	// Helper to get or create a node for a coordinate
	const getOrCreateNode = (lon: number, lat: number): number => {
		const coordKey = `${lon},${lat}`
		const existingNodeId = nodeMap.get(coordKey)
		if (existingNodeId !== undefined) {
			return existingNodeId
		}

		const nodeId = nextNodeId++
		nodeMap.set(coordKey, nodeId)
		usedNodeIds.add(nodeId)

		const node: OsmNode = {
			id: nodeId,
			lon,
			lat,
		}
		osm.nodes.addNode(node)
		return nodeId
	}

	// Process each feature
	for (const feature of geojson.features) {
		// Normalize winding order using rewind (outer rings counterclockwise, inner rings clockwise)
		const normalizedFeature = rewind(feature, false)
		const tags = propertiesToTags(normalizedFeature.properties)
		const featureId = extractFeatureId(normalizedFeature.id)

		if (normalizedFeature.geometry.type === "Point") {
			const coords = normalizedFeature.geometry.coordinates
			const lon = coords[0]
			const lat = coords[1]
			if (lon === undefined || lat === undefined) continue
			const coordKey = `${lon},${lat}`

			if (featureId !== undefined) {
				// Feature has an ID, check if node already exists
				if (!usedNodeIds.has(featureId)) {
					osm.nodes.addNode({
						id: featureId,
						lon,
						lat,
						tags,
					})
					nodeMap.set(coordKey, featureId)
					usedNodeIds.add(featureId)
					if (featureId >= nextNodeId) {
						nextNodeId = featureId + 1
					}
				}
			} else {
				// No feature ID, check if node already exists at this coordinate
				const existingNodeId = nodeMap.get(coordKey)
				if (existingNodeId !== undefined) {
					// Node already exists, skip (tags will be handled by merge deduplication)
					continue
				}

				// Create new node with sequential ID
				const nodeId = nextNodeId++
				nodeMap.set(coordKey, nodeId)
				usedNodeIds.add(nodeId)
				osm.nodes.addNode({
					id: nodeId,
					lon,
					lat,
					tags,
				})
			}
		} else if (normalizedFeature.geometry.type === "LineString") {
			const coordinates = normalizedFeature.geometry.coordinates
			if (coordinates.length < 2) continue // Skip invalid LineStrings

			// Create or get nodes for each coordinate
			const nodeRefs: number[] = []
			for (const coord of coordinates) {
				const lon = coord[0]
				const lat = coord[1]
				if (lon === undefined || lat === undefined) continue
				const nodeId = getOrCreateNode(lon, lat)
				nodeRefs.push(nodeId)
			}

			// Create the way
			const wayId = featureId ?? nextWayId++
			if (!usedWayIds.has(wayId)) {
				osm.ways.addWay({
					id: wayId,
					refs: nodeRefs,
					tags,
				})
				usedWayIds.add(wayId)
				if (featureId && wayId >= nextWayId) {
					nextWayId = wayId + 1
				}
			}
		} else if (normalizedFeature.geometry.type === "Polygon") {
			const coordinates = normalizedFeature.geometry.coordinates
			if (coordinates.length === 0) continue

			// First ring is outer boundary, subsequent rings are holes
			const outerRing = coordinates[0]
			if (!outerRing || outerRing.length < 3) continue // Need at least 3 points for a polygon

			// Create nodes for outer ring
			const outerNodeRefs: number[] = []
			for (const coord of outerRing) {
				const lon = coord[0]
				const lat = coord[1]
				if (lon === undefined || lat === undefined) continue
				const nodeId = getOrCreateNode(lon, lat)
				outerNodeRefs.push(nodeId)
			}

			// Ensure the ring is closed (first and last node are the same)
			if (outerNodeRefs.length > 0) {
				const first = outerNodeRefs[0]
				const last = outerNodeRefs[outerNodeRefs.length - 1]
				if (first !== undefined && last !== undefined && first !== last) {
					outerNodeRefs.push(first)
				}
			}

			// Create way for outer ring with area tags
			const outerWayId = featureId ?? nextWayId++
			if (!usedWayIds.has(outerWayId)) {
				const areaTags: OsmTags = { ...tags, area: "yes" }
				osm.ways.addWay({
					id: outerWayId,
					refs: outerNodeRefs,
					tags: areaTags,
				})
				usedWayIds.add(outerWayId)
				if (featureId && outerWayId >= nextWayId) {
					nextWayId = outerWayId + 1
				}
			}

			// Create separate ways for holes
			for (let i = 1; i < coordinates.length; i++) {
				const holeRing = coordinates[i]
				if (!holeRing || holeRing.length < 3) continue

				const holeNodeRefs: number[] = []
				for (const coord of holeRing) {
					const lon = coord[0]
					const lat = coord[1]
					if (lon === undefined || lat === undefined) continue
					const nodeId = getOrCreateNode(lon, lat)
					holeNodeRefs.push(nodeId)
				}

				// Ensure the ring is closed
				if (holeNodeRefs.length > 0) {
					const first = holeNodeRefs[0]
					const last = holeNodeRefs[holeNodeRefs.length - 1]
					if (first !== undefined && last !== undefined && first !== last) {
						holeNodeRefs.push(first)
					}
				}

				// Create way for hole
				const holeWayId = nextWayId++
				if (!usedWayIds.has(holeWayId)) {
					osm.ways.addWay({
						id: holeWayId,
						refs: holeNodeRefs,
						tags: { ...tags, area: "yes" },
					})
					usedWayIds.add(holeWayId)
				}
			}
		} else if (normalizedFeature.geometry.type === "MultiPolygon") {
			const coordinates = normalizedFeature.geometry.coordinates
			if (coordinates.length === 0) continue

			// Process each polygon in the MultiPolygon
			for (const polygon of coordinates) {
				if (polygon.length === 0) continue

				const outerRing = polygon[0]
				if (!outerRing || outerRing.length < 3) continue

				// Create nodes for outer ring
				const outerNodeRefs: number[] = []
				for (const coord of outerRing) {
					const lon = coord[0]
					const lat = coord[1]
					if (lon === undefined || lat === undefined) continue
					const nodeId = getOrCreateNode(lon, lat)
					outerNodeRefs.push(nodeId)
				}

				// Ensure the ring is closed
				if (outerNodeRefs.length > 0) {
					const first = outerNodeRefs[0]
					const last = outerNodeRefs[outerNodeRefs.length - 1]
					if (first !== undefined && last !== undefined && first !== last) {
						outerNodeRefs.push(first)
					}
				}

				// Create way for outer ring
				const outerWayId = nextWayId++
				if (!usedWayIds.has(outerWayId)) {
					const areaTags: OsmTags = { ...tags, area: "yes" }
					osm.ways.addWay({
						id: outerWayId,
						refs: outerNodeRefs,
						tags: areaTags,
					})
					usedWayIds.add(outerWayId)
				}

				// Create separate ways for holes in this polygon
				for (let i = 1; i < polygon.length; i++) {
					const holeRing = polygon[i]
					if (!holeRing || holeRing.length < 3) continue

					const holeNodeRefs: number[] = []
					for (const coord of holeRing) {
						const lon = coord[0]
						const lat = coord[1]
						if (lon === undefined || lat === undefined) continue
						const nodeId = getOrCreateNode(lon, lat)
						holeNodeRefs.push(nodeId)
					}

					// Ensure the ring is closed
					if (holeNodeRefs.length > 0) {
						const first = holeNodeRefs[0]
						const last = holeNodeRefs[holeNodeRefs.length - 1]
						if (first !== undefined && last !== undefined && first !== last) {
							holeNodeRefs.push(first)
						}
					}

					// Create way for hole
					const holeWayId = nextWayId++
					if (!usedWayIds.has(holeWayId)) {
						osm.ways.addWay({
							id: holeWayId,
							refs: holeNodeRefs,
							tags: { ...tags, area: "yes" },
						})
						usedWayIds.add(holeWayId)
					}
				}
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
