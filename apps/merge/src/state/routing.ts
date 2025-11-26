import type { Osm } from "@osmix/core"
import type { PathSegment, RouteResult, RoutingGraph } from "@osmix/router"
import type { LonLat } from "@osmix/shared/types"
import { atom } from "jotai"

/** Snapped node info with distance from original click point. */
export interface SnappedNode {
	/** Internal node index. */
	nodeIndex: number
	/** OSM node ID. */
	nodeId: number
	/** Node coordinates [lon, lat]. */
	coordinates: LonLat
	/** Distance from click point to node in meters. */
	distance: number
}

/** Per-way segment with distance and time (consecutive same-name ways merged). */
export interface WaySegment {
	/** OSM way IDs included in this segment (multiple if merged). */
	wayIds: number[]
	/** Way name from tags (may be empty). */
	name: string
	/** Highway type from tags. */
	highway: string
	/** Distance travelled on this segment in meters. */
	distance: number
	/** Time travelled on this segment in seconds. */
	time: number
}

/** Result of calculating route statistics. */
export interface RouteStats {
	/** Total route distance in meters. */
	totalDistance: number
	/** Total route time in seconds. */
	totalTime: number
	/** Per-way breakdown (consecutive same-name ways merged). */
	waySegments: WaySegment[]
	/** Coordinates where way name changes (turn points). */
	turnPoints: LonLat[]
}

/** Complete routing state for a single route. */
export interface RoutingState {
	fromPoint: LonLat | null
	toPoint: LonLat | null
	fromNode: SnappedNode | null
	toNode: SnappedNode | null
	result: RouteResult | null
	/** Per-way breakdown of route. */
	waySegments: WaySegment[]
	/** Coordinates where way name changes (turn points). */
	turnPoints: LonLat[]
	/** Total route distance in meters. */
	totalDistance: number
	/** Total route time in seconds. */
	totalTime: number
}

const initialState: RoutingState = {
	fromPoint: null,
	toPoint: null,
	fromNode: null,
	toNode: null,
	result: null,
	waySegments: [],
	turnPoints: [],
	totalDistance: 0,
	totalTime: 0,
}

/** Main routing state atom. */
export const routingStateAtom = atom<RoutingState>(initialState)

/** Cached routing graph keyed by osm id. */
export const routingGraphAtom = atom<{
	osmId: string
	graph: RoutingGraph
} | null>(null)

/** Reset routing state to initial values. */
export const clearRoutingAtom = atom(null, (_get, set) => {
	set(routingStateAtom, initialState)
})

/** Get display name for a way (name or highway type). */
function getDisplayName(tags: Record<string, string | number> | undefined) {
	const name = (tags?.["name"] as string) ?? ""
	const highway = (tags?.["highway"] as string) ?? ""
	return name || highway
}

/**
 * Calculate route statistics from path segments.
 * Merges consecutive ways with the same name into single segments.
 * Returns turn points where the way name changes.
 */
export function calculateRouteStats(
	path: PathSegment[],
	graph: RoutingGraph,
	osm: Osm,
): RouteStats {
	let totalDistance = 0
	let totalTime = 0

	// First pass: collect per-way stats and build ordered list with node info
	// Store the START node of each edge (previousNodeIndex) so we can correctly
	// identify where way transitions occur (the turn point is where the previous
	// way ends and the new way begins)
	const wayStats = new Map<number, { distance: number; time: number }>()
	const waySequence: { wayIndex: number; transitionNodeIndex: number }[] = []

	for (const seg of path) {
		if (seg.wayIndex !== undefined && seg.previousNodeIndex !== undefined) {
			const edges = graph.getEdges(seg.previousNodeIndex)
			const edge = edges.find(
				(e) =>
					e.targetNodeIndex === seg.nodeIndex && e.wayIndex === seg.wayIndex,
			)
			if (edge) {
				totalDistance += edge.distance
				totalTime += edge.time

				// Track this way appearance with the transition node (start of this edge)
				// This is where the previous way ends and this way begins
				waySequence.push({
					wayIndex: seg.wayIndex,
					transitionNodeIndex: seg.previousNodeIndex,
				})

				// Accumulate per-way stats
				const existing = wayStats.get(seg.wayIndex)
				if (existing) {
					existing.distance += edge.distance
					existing.time += edge.time
				} else {
					wayStats.set(seg.wayIndex, {
						distance: edge.distance,
						time: edge.time,
					})
				}
			}
		}
	}

	// Second pass: build segments, merging consecutive same-name ways
	// Track turn points where the display name changes
	const waySegments: WaySegment[] = []
	const turnPoints: LonLat[] = []
	let currentSegment: WaySegment | null = null
	let currentDisplayName: string | null = null
	const processedWayIndexes = new Set<number>()

	for (const { wayIndex, transitionNodeIndex } of waySequence) {
		// Skip if we've already processed this way index in a previous segment
		if (processedWayIndexes.has(wayIndex)) continue
		processedWayIndexes.add(wayIndex)

		const wayId = osm.ways.ids.at(wayIndex)
		const tags = osm.ways.tags.getTags(wayIndex)
		const name = (tags?.["name"] as string) ?? ""
		const highway = (tags?.["highway"] as string) ?? ""
		const displayName = getDisplayName(tags)
		const stats = wayStats.get(wayIndex)

		if (!stats) continue

		if (currentSegment && currentDisplayName === displayName) {
			// Merge with current segment (same name)
			currentSegment.wayIds.push(wayId)
			currentSegment.distance += stats.distance
			currentSegment.time += stats.time
		} else {
			// Name changed - record turn point and start new segment
			if (currentSegment) {
				waySegments.push(currentSegment)
				// Add turn point at the transition node (where previous way ends
				// and new way begins - this is the correct location for the turn)
				const coord = osm.nodes.getNodeLonLat({ index: transitionNodeIndex })
				if (coord) {
					turnPoints.push(coord)
				}
			}
			currentSegment = {
				wayIds: [wayId],
				name,
				highway,
				distance: stats.distance,
				time: stats.time,
			}
			currentDisplayName = displayName
		}
	}

	// Don't forget the last segment
	if (currentSegment) {
		waySegments.push(currentSegment)
	}

	return { totalDistance, totalTime, waySegments, turnPoints }
}

/** Derived atom that builds GeoJSON from routing state. */
export const routingGeoJsonAtom = atom<GeoJSON.FeatureCollection>((get) => {
	const routingState = get(routingStateAtom)
	const features: GeoJSON.Feature[] = []

	// Route line
	if (routingState.result && routingState.result.coordinates.length > 1) {
		features.push({
			type: "Feature",
			properties: { layer: "route" },
			geometry: {
				type: "LineString",
				coordinates: routingState.result.coordinates,
			},
		})
	}

	// Snap lines (from click point to snapped node)
	if (routingState.fromPoint && routingState.fromNode) {
		features.push({
			type: "Feature",
			properties: { layer: "snap-line" },
			geometry: {
				type: "LineString",
				coordinates: [
					routingState.fromPoint,
					routingState.fromNode.coordinates,
				],
			},
		})
	}
	if (routingState.toPoint && routingState.toNode) {
		features.push({
			type: "Feature",
			properties: { layer: "snap-line" },
			geometry: {
				type: "LineString",
				coordinates: [routingState.toPoint, routingState.toNode.coordinates],
			},
		})
	}

	// Turn points (where way name changes)
	for (const coord of routingState.turnPoints) {
		features.push({
			type: "Feature",
			properties: { layer: "turn-point" },
			geometry: {
				type: "Point",
				coordinates: coord,
			},
		})
	}

	// Click points
	if (routingState.fromPoint) {
		features.push({
			type: "Feature",
			properties: { layer: "click-point", type: "from" },
			geometry: {
				type: "Point",
				coordinates: routingState.fromPoint,
			},
		})
	}
	if (routingState.toPoint) {
		features.push({
			type: "Feature",
			properties: { layer: "click-point", type: "to" },
			geometry: {
				type: "Point",
				coordinates: routingState.toPoint,
			},
		})
	}

	// Snapped nodes
	if (routingState.fromNode) {
		features.push({
			type: "Feature",
			properties: { layer: "snap-point", type: "from" },
			geometry: {
				type: "Point",
				coordinates: routingState.fromNode.coordinates,
			},
		})
	}
	if (routingState.toNode) {
		features.push({
			type: "Feature",
			properties: { layer: "snap-point", type: "to" },
			geometry: {
				type: "Point",
				coordinates: routingState.toNode.coordinates,
			},
		})
	}

	return { type: "FeatureCollection", features }
})
