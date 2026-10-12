import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { buildGraph, Router } from "../src/index.ts";

function finish(osm: Osm): Osm {
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("graph build with missing nodes", () => {
  it("skips segments that touch a node outside the dataset", () => {
    const osm = new Osm({ id: "dangling" });
    osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    osm.nodes.addNode({ id: 2, lon: 0.001, lat: 0 });
    osm.nodes.addNode({ id: 3, lon: 0.002, lat: 0 });
    // Node 99 is not in the dataset, as after a bbox extract.
    osm.ways.addWay({ id: 10, refs: [99, 1, 2, 3], tags: { highway: "residential" } });
    finish(osm);

    const graph = buildGraph(osm);
    // Two two-way segments remain: 1-2 and 2-3.
    expect(graph.edges).toBe(4);
    const targets = new Uint32Array(graph.transferables().edgeTargets);
    for (const target of targets) expect(target).toBeLessThan(graph.size);

    const router = new Router(osm, graph);
    const path = router.route(0, 2);
    expect(path?.map((p) => p.nodeIndex)).toEqual([0, 1, 2]);
  });
});

describe("bidirectional routing on one-way streets", () => {
  it("never travels against a one-way", () => {
    const osm = new Osm({ id: "one-way" });
    osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    osm.nodes.addNode({ id: 2, lon: 0.001, lat: 0 });
    osm.nodes.addNode({ id: 3, lon: 0.002, lat: 0 });
    osm.nodes.addNode({ id: 4, lon: 0.001, lat: 0.01 });
    osm.ways.addWay({ id: 10, refs: [1, 2, 3], tags: { highway: "residential", oneway: "yes" } });
    osm.ways.addWay({ id: 11, refs: [3, 4, 1], tags: { highway: "residential" } });
    finish(osm);

    const graph = buildGraph(osm);
    const router = new Router(osm, graph, { algorithm: "bidirectional" });
    const node = (id: number) => osm.nodes.ids.getIndexFromId(id);

    const back = router.route(node(3), node(1));
    expect(back?.map((p) => osm.nodes.ids.at(p.nodeIndex))).toEqual([3, 4, 1]);
    const dijkstra = router.route(node(3), node(1), { algorithm: "dijkstra" });
    expect(back?.at(-1)?.cost).toBeCloseTo(dijkstra!.at(-1)!.cost);

    const incoming = graph
      .getIncomingEdges(node(2))
      .map((e) => osm.nodes.ids.at(e.targetNodeIndex));
    expect(incoming).toEqual([1]);
  });
});

describe("A* time heuristic", () => {
  it("stays optimal when a maxspeed is above 130 km/h", () => {
    // A slow direct road (100 km/h, ~11 km) and a much longer detour at 1,000 km/h.
    // The detour is faster. A heuristic fixed at 130 km/h overestimates on it.
    const osm = new Osm({ id: "fast-road" });
    osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    osm.nodes.addNode({ id: 2, lon: 0.1, lat: 0 });
    osm.nodes.addNode({ id: 3, lon: 0.05, lat: 0.3 });
    osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "primary", maxspeed: "100" } });
    osm.ways.addWay({ id: 11, refs: [1, 3, 2], tags: { highway: "motorway", maxspeed: "1000" } });
    finish(osm);

    const graph = buildGraph(osm);
    expect(graph.maxSpeedMps).toBeCloseTo(1000 / 3.6, 2);

    const router = new Router(osm, graph, { metric: "time" });
    const astar = router.route(0, 1, { algorithm: "astar" });
    const dijkstra = router.route(0, 1, { algorithm: "dijkstra" });
    expect(astar?.map((p) => p.nodeIndex)).toEqual([0, 2, 1]);
    expect(astar?.at(-1)?.cost).toBeCloseTo(dijkstra!.at(-1)!.cost);
  });
});
