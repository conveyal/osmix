import { describe, expect, it } from "vitest";

import {
  initialRoutingState,
  routeResultStillApplies,
  type SnappedNode,
} from "../src/state/routing.ts";

const from: SnappedNode = { nodeIndex: 1, nodeId: 10, coordinates: [7.42, 43.73], distance: 3 };
const other: SnappedNode = { nodeIndex: 2, nodeId: 20, coordinates: [7.43, 43.74], distance: 5 };

describe("routeResultStillApplies", () => {
  it("applies while the same start point is waiting for a destination", () => {
    const state = { ...initialRoutingState, fromPoint: from.coordinates, fromNode: from };
    expect(routeResultStillApplies(state, from)).toBe(true);
  });

  it("is stale after the route was cleared during the computation", () => {
    expect(routeResultStillApplies(initialRoutingState, from)).toBe(false);
  });

  it("is stale when another start point replaced the one it was computed from", () => {
    const state = { ...initialRoutingState, fromPoint: other.coordinates, fromNode: other };
    expect(routeResultStillApplies(state, from)).toBe(false);
  });

  it("is stale once a destination has already been written", () => {
    const state = {
      ...initialRoutingState,
      fromPoint: from.coordinates,
      fromNode: from,
      toPoint: other.coordinates,
      toNode: other,
    };
    expect(routeResultStillApplies(state, from)).toBe(false);
  });
});
