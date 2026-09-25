import { mapModeAtom, selectOsmEntityAtom } from "@osmix/app-core";
import type { Feature, FeatureCollection } from "geojson";
import { atom } from "jotai";
import type { RouteResult, WaySegment } from "osmix";
import type { LonLat } from "osmix";

/** Snapped node info with distance from original click point. */
export interface SnappedNode {
  /** Internal node index. */
  nodeIndex: number;
  /** OSM node ID. */
  nodeId: number;
  /** Node coordinates [lon, lat]. */
  coordinates: LonLat;
  /** Distance from click point to node in meters. */
  distance: number;
}

// Re-export WaySegment for convenience
export type { WaySegment };

/** Complete routing state for a single route. */
export interface RoutingState {
  fromPoint: LonLat | null;
  toPoint: LonLat | null;
  fromNode: SnappedNode | null;
  toNode: SnappedNode | null;
  /** Route result with coordinates and optional stats/path info. */
  result: RouteResult | null;
  /** The dataset the points were snapped on; `null` until the first point snaps. */
  osmId: string | null;
}

/** The empty routing state: no points, no snapped nodes, no result. */
export const initialRoutingState: RoutingState = {
  fromPoint: null,
  toPoint: null,
  fromNode: null,
  toNode: null,
  result: null,
  osmId: null,
};

/** Main routing state atom. */
export const routingStateAtom = atom<RoutingState>(initialRoutingState);

/**
 * Whether a route computed from `fromNode` may still be written into `state`: the start point
 * must be the same snapped node and no destination may have arrived since. "Clear route" or a
 * new start point during the computation makes the result stale.
 */
export function routeResultStillApplies(state: RoutingState, fromNode: SnappedNode): boolean {
  return state.fromNode === fromNode && state.toNode === null;
}

/** Enter the routing tool: clear the selected entity, then switch map clicks to routing. */
export const enterRoutingModeAtom = atom(null, (_get, set) => {
  set(selectOsmEntityAtom, null, null);
  set(mapModeAtom, "route");
});

/** Leave the routing tool: map clicks select again and the route is cleared. */
export const exitRoutingModeAtom = atom(null, (_get, set) => {
  set(mapModeAtom, "select");
  set(routingStateAtom, initialRoutingState);
});

/** Derived atom that builds GeoJSON from routing state. */
export const routingGeoJsonAtom = atom<FeatureCollection>((get) => {
  const routingState = get(routingStateAtom);
  const features: Feature[] = [];

  // Route line
  if (routingState.result && routingState.result.coordinates.length > 1) {
    features.push({
      type: "Feature",
      properties: { layer: "route" },
      geometry: {
        type: "LineString",
        coordinates: routingState.result.coordinates,
      },
    });
  }

  // Snap lines (from click point to snapped node)
  if (routingState.fromPoint && routingState.fromNode) {
    features.push({
      type: "Feature",
      properties: { layer: "snap-line" },
      geometry: {
        type: "LineString",
        coordinates: [routingState.fromPoint, routingState.fromNode.coordinates],
      },
    });
  }
  if (routingState.toPoint && routingState.toNode) {
    features.push({
      type: "Feature",
      properties: { layer: "snap-line" },
      geometry: {
        type: "LineString",
        coordinates: [routingState.toPoint, routingState.toNode.coordinates],
      },
    });
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
      });
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
    });
  }
  if (routingState.toPoint) {
    features.push({
      type: "Feature",
      properties: { layer: "click-point", type: "to" },
      geometry: {
        type: "Point",
        coordinates: routingState.toPoint,
      },
    });
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
    });
  }
  if (routingState.toNode) {
    features.push({
      type: "Feature",
      properties: { layer: "snap-point", type: "to" },
      geometry: {
        type: "Point",
        coordinates: routingState.toNode.coordinates,
      },
    });
  }

  return { type: "FeatureCollection", features };
});
