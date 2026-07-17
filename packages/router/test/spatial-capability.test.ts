import { Osm, SpatialIndexNotBuiltError } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { buildGraph } from "../src/graph.ts";

describe("routing node spatial capability", () => {
  it("requires an all-node index for snapping and succeeds once it is built", () => {
    const osm = new Osm({ id: "routing-capability" });
    osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    osm.nodes.addNode({ id: 2, lon: 0.01, lat: 0 });
    osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "primary" } });
    osm.buildIndexes();
    osm.nodes.buildSpatialIndex("tagged");
    const graph = buildGraph(osm);

    expect(() => graph.findNearestRoutableNode(osm, [0, 0], 100)).toThrowError(
      SpatialIndexNotBuiltError,
    );

    osm.nodes.buildSpatialIndex("all");
    expect(graph.findNearestRoutableNode(osm, [0, 0], 100)).toMatchObject({ nodeIndex: 0 });
  });
});
