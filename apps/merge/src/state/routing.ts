import type { RouteResult, WaySegment } from "@osmix/router"
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

// Re-export WaySegment for convenience
export type { WaySegment }

/** Complete routing state for a single route. */
export interface RoutingState {
	fromPoint: LonLat | null
	toPoint: LonLat | null
	fromNode: SnappedNode | null
	toNode: SnappedNode | null
	/** Route result with coordinates and optional stats/path info. */
	result: RouteResult | null
}

const initialState: RoutingState = {
	fromPoint: null,
	toPoint: null,
	fromNode: null,
	toNode: null,
	result: null,
}

/** Main routing state atom. */
export const routingStateAtom = atom<RoutingState>(initialState)

/** Reset routing state to initial values. */
export const clearRoutingAtom = atom(null, (_get, set) => {
	set(routingStateAtom, initialState)
})

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
	if (routingState.result?.turnPoints) {
		for (const coord of routingState.result.turnPoints) {
			features.push({
				type: "Feature",
				properties: { layer: "turn-point" },
				geometry: {
					type: "Point",
					coordinates: coord,
				},
			})
		}
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
