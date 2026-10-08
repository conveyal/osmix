import { Osm } from "@osmix/core";
import type { OsmNode, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { PlanOverlay } from "../src/plan/overlay.ts";

/**
 * The patch as a plan's layer (T35): untouched imported entities read from the patch, and one
 * a phase drops must be gone from every read, as a dropped record was.
 */

function dataset(id: string, nodes: OsmNode[], ways: OsmWay[] = []) {
  const osm = new Osm({ id });
  for (const node of nodes) osm.nodes.addNode(node);
  for (const way of ways) osm.ways.addWay(way);
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

const base = () =>
  dataset(
    "base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0.001, lat: 0 },
    ],
    [{ id: 10, refs: [1, 2], tags: { highway: "residential" } }],
  );

// Imported way -1 runs from imported point -1 to base node 2; -2 is a standalone point.
const patch = () =>
  dataset(
    "patch",
    [
      { id: -1, lon: 0.001, lat: 0.001 },
      { id: -2, lon: 0.002, lat: 0.002, tags: { amenity: "bench" } },
    ],
    [{ id: -1, refs: [-1, 2], tags: { highway: "footway" } }],
  );

function layered() {
  const overlay = new PlanOverlay(base());
  overlay.usePatchLayer(patch());
  return overlay;
}

/** Everything the overlay says about imported point -1 and way -1. */
function reads(overlay: PlanOverlay) {
  return {
    node: overlay.getNode(-1),
    way: overlay.getWay(-1),
    nodeRecord: overlay.nodeChanges.get(-1)?.changeType,
    nodes: [...overlay.nodes()].map(({ id }) => id),
    ways: [...overlay.ways()].map(({ id }) => id),
    waysAtBaseNode: overlay.waysAtNode(2).map(({ id }) => id),
    waysAtNode: overlay.waysAtNode(-1).map(({ id }) => id),
    pendingAt: [...overlay.pendingWayIdsAt(-1)],
    nearPoint: overlay.nodesWithinRadius(0.001, 0.001, 5).map(({ id }) => id),
    nearWays: overlay.wayIdsIntersecting([0.0005, 0.0005, 0.0015, 0.0015]),
    minNodeId: overlay.minNodeId(),
    nodeCount: overlay.nodeCount,
  };
}

describe("patch layer", () => {
  it("reads untouched imported entities from the patch, as create records", () => {
    const overlay = layered();
    expect(overlay.nodeChanges.size + overlay.wayChanges.size).toBe(0);
    expect(reads(overlay)).toEqual({
      node: { id: -1, lon: 0.001, lat: 0.001 },
      way: { id: -1, refs: [-1, 2], tags: { highway: "footway" } },
      nodeRecord: "create",
      nodes: [1, 2, -1, -2],
      ways: [10, -1],
      waysAtBaseNode: [10, -1],
      waysAtNode: [-1],
      pendingAt: [-1],
      nearPoint: [-1],
      nearWays: [-1],
      minNodeId: -2,
      nodeCount: 4,
    });
    expect(overlay.wayCoordinates(overlay.getWay(-1)!)).toEqual([
      [0.001, 0.001],
      [0.001, 0],
    ]);
  });

  it("forgets a dropped import on every read, and brings it back on undo", () => {
    const overlay = layered();
    const before = reads(overlay);
    const mark = overlay.mark();
    const earlier = overlay.stateAt(mark);
    overlay.discard("way", -1);
    overlay.discard("node", -1);
    overlay.discard("node", -2);
    expect(reads(overlay)).toEqual({
      node: null,
      way: null,
      nodeRecord: undefined,
      nodes: [1, 2],
      ways: [10],
      waysAtBaseNode: [10],
      waysAtNode: [],
      pendingAt: [],
      nearPoint: [],
      nearWays: [],
      minNodeId: 0,
      nodeCount: 2,
    });
    // The state at the mark still reads them from the layer.
    expect(earlier.getNode(-1)).toEqual(before.node);
    expect(earlier.getWay(-1)).toEqual(before.way);
    overlay.undoTo(mark);
    expect(reads(overlay)).toEqual(before);
  });

  it("finds an imported way by the base nodes it uses, in box queries too", () => {
    const overlay = layered();
    // Way -1 reaches base node 2 at (0.001, 0), outside its patch node's box at (0.001, 0.001).
    expect(overlay.wayIdsIntersecting([0.0009, -0.0001, 0.0011, 0.0001])).toEqual([-1, 10]);
  });

  it("writes a record of its own over a layer entity it changes", () => {
    const overlay = layered();
    overlay.modify("way", -1, (way) => ({ ...way, refs: [-1, 1] }));
    expect(overlay.wayChanges.get(-1)).toMatchObject({
      changeType: "create",
      entity: { refs: [-1, 1] },
    });
    expect(overlay.waysAtNode(1).map(({ id }) => id)).toEqual([10, -1]);
    expect(overlay.waysAtNode(2).map(({ id }) => id)).toEqual([10]);
  });

  it("still finds a layer way at its nodes after a change to its tags alone", () => {
    // Regression: a tag-only change gave the way a record of its own, which layer reads skip,
    // but left it out of the pending ways by node, so a crossing snap missed it (T35).
    const overlay = layered();
    expect(overlay.waysAtNode(-1).map(({ id }) => id)).toEqual([-1]);
    overlay.modify("way", -1, (way) => ({ ...way, tags: { ...way.tags, surface: "concrete" } }));
    expect(overlay.waysAtNode(-1).map(({ id }) => id)).toEqual([-1]);
    expect(overlay.waysAtNode(2).map(({ id }) => id)).toEqual([10, -1]);
    expect([...overlay.pendingWayIdsAt(-1)]).toEqual([-1]);
  });

  it("counts records by change type as listing them would, overrides and drops included", () => {
    const overlay = layered();
    const listed = () => {
      const counts = { create: 0, modify: 0, delete: 0 };
      for (const table of [overlay.nodeChanges, overlay.wayChanges]) {
        for (const change of table.values()) counts[change.changeType]++;
      }
      return counts;
    };
    const counted = () => {
      const nodes = overlay.nodeChanges.countByType();
      const ways = overlay.wayChanges.countByType();
      return {
        create: nodes.create + ways.create,
        modify: nodes.modify + ways.modify,
        delete: nodes.delete + ways.delete,
      };
    };
    expect(counted()).toEqual({ create: 3, modify: 0, delete: 0 });
    overlay.modify("way", -1, (way) => ({ ...way, refs: [-1, 1] }));
    overlay.discard("node", -2);
    overlay.modify("node", 1, (node) => ({ ...node, lon: 0.0001 }));
    expect(counted()).toEqual(listed());
    expect(counted()).toEqual({ create: 2, modify: 1, delete: 0 });
  });
});
