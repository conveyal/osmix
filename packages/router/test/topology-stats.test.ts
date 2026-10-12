import { Osm } from "@osmix/core";
import { fromPbf } from "@osmix/load";
import { getFixtureFile, PBFs } from "@osmix/test-utils/fixtures";
import { describe, expect, it } from "vitest";

import {
  defaultHighwayFilter,
  type HighwayFilter,
  RoutingGraph,
  routingTopologyStats,
} from "../src/index.ts";

/** The reference: the same counts read from a fully built `RoutingGraph`. */
function graphStats(osm: Osm, filter: HighwayFilter) {
  const graph = new RoutingGraph(osm, filter);
  const parent = new Map<number, number>();
  const find = (index: number): number => {
    let root = index;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (let index = 0; index < graph.size; index++) {
    if (graph.isRoutable(index)) parent.set(index, index);
  }
  for (const index of parent.keys()) {
    for (const edge of graph.getEdges(index)) parent.set(find(edge.targetNodeIndex), find(index));
  }
  const roots = new Set([...parent.keys()].map(find));
  return {
    nodes: graph.size,
    routableNodes: parent.size,
    edges: graph.edges,
    components: roots.size,
  };
}

const osmSource = (osm: Osm) => ({ nodeCount: osm.nodes.size, ways: () => osm.ways });
const walkFilter: HighwayFilter = (tags) =>
  tags?.["highway"] != null || tags?.["public_transport"] === "platform";

function syntheticOsm() {
  const osm = new Osm({ id: "synthetic" });
  for (let id = 1; id <= 14; id++) osm.nodes.addNode({ id, lon: id * 0.001, lat: 0 });
  osm.nodes.buildIndex();
  osm.ways.addWay({ id: 1, refs: [1, 2, 3], tags: { highway: "residential" } });
  osm.ways.addWay({ id: 2, refs: [3, 4], tags: { highway: "primary", oneway: "yes" } });
  osm.ways.addWay({ id: 3, refs: [4, 5], tags: { highway: "primary", oneway: "-1" } });
  osm.ways.addWay({
    id: 4,
    refs: [6, 7, 8, 6],
    tags: { highway: "primary", junction: "roundabout", oneway: "reversible" },
  });
  osm.ways.addWay({ id: 5, refs: [9, 10], tags: { highway: "footway" } });
  osm.ways.addWay({ id: 6, refs: [11, 12], tags: { building: "yes" } });
  osm.ways.addWay({ id: 7, refs: [13], tags: { highway: "residential" } });
  osm.ways.addWay({ id: 8, refs: [13, 14], tags: { public_transport: "platform" } });
  osm.ways.addWay({ id: 9, refs: [5, 6], tags: { highway: "service", oneway: "alternating" } });
  osm.buildIndexes();
  return osm;
}

describe("routingTopologyStats", () => {
  it("matches RoutingGraph on one-way, roundabout, filtered and single-node ways", () => {
    const osm = syntheticOsm();
    for (const filter of [defaultHighwayFilter, walkFilter]) {
      expect(routingTopologyStats(osmSource(osm), filter)).toEqual(graphStats(osm, filter));
    }
    expect(routingTopologyStats(osmSource(osm), walkFilter)).toEqual({
      nodes: 14,
      routableNodes: 12,
      edges: 15,
      components: 3,
    });
  });

  it("matches RoutingGraph on Monaco", async () => {
    const osm = await fromPbf(await getFixtureFile(PBFs["monaco"]!.url));
    for (const filter of [defaultHighwayFilter, walkFilter]) {
      expect(routingTopologyStats(osmSource(osm), filter)).toEqual(graphStats(osm, filter));
    }
  });
});
