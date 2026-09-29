import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { CONVEYAL_EXTRACT_TAG_FILTERS } from "../src/extract-tag-filter.ts";
import { fromPbf, toPbfBuffer } from "../src/pbf.ts";
import { pruneUnreferencedNodes } from "../src/prune-nodes.ts";

/** A street network with a turn restriction, a building, and standalone nodes. */
function buildStreetsOsm() {
  const osm = new Osm({ id: "streets" });
  osm.nodes.addNode({ id: 1, lat: 0, lon: 0 });
  osm.nodes.addNode({ id: 2, lat: 0, lon: 0.001 });
  osm.nodes.addNode({ id: 3, lat: 0, lon: 0.002 });
  osm.nodes.addNode({ id: 4, lat: 0, lon: 0.003, tags: { highway: "traffic_signals" } });
  osm.nodes.addNode({ id: 5, lat: 0.01, lon: 0, tags: { entrance: "main" } });
  osm.nodes.addNode({ id: 6, lat: 0.01, lon: 0.001 });
  osm.nodes.addNode({ id: 7, lat: 0.011, lon: 0.001 });
  osm.nodes.addNode({ id: 8, lat: 0.02, lon: 0, tags: { park_ride: "yes", name: "Lot" } });
  osm.nodes.addNode({ id: 9, lat: 0.02, lon: 0.001, tags: { amenity: "bench" } });
  osm.nodes.addNode({ id: 11, lat: 0.001, lon: 0.001 });
  osm.ways.addWay({ id: 10, refs: [1, 2, 3, 4], tags: { highway: "residential" } });
  osm.ways.addWay({ id: 11, refs: [2, 11], tags: { highway: "service" } });
  osm.ways.addWay({ id: 20, refs: [5, 6, 7, 5], tags: { building: "yes" } });
  osm.relations.addRelation({
    id: 30,
    members: [
      { type: "way", ref: 10, role: "from" },
      { type: "node", ref: 2, role: "via" },
      { type: "way", ref: 11, role: "to" },
    ],
    tags: { type: "restriction", restriction: "no_right_turn" },
  });
  osm.buildIndexes();
  return osm;
}

describe("pruneUnreferencedNodes", () => {
  it("keeps referenced and matching nodes, and drops the rest", () => {
    const source = new Osm({ id: "source" });
    source.nodes.addNode({ id: 1, lat: 0, lon: 0 });
    source.nodes.addNode({ id: 2, lat: 0, lon: 1 });
    source.nodes.addNode({ id: 3, lat: 1, lon: 0, tags: { park_ride: "yes" } });
    source.nodes.addNode({ id: 4, lat: 1, lon: 1, tags: { amenity: "bench" } });
    source.nodes.addNode({ id: 5, lat: 2, lon: 2 });
    source.nodes.addNode({ id: 6, lat: 3, lon: 3 });
    source.ways.addWay({ id: 10, refs: [1, 2, 99] });
    source.relations.addRelation({ id: 20, members: [{ type: "node", ref: 6, role: "via" }] });
    source.buildIndexes();

    const pruned = pruneUnreferencedNodes(source, [{ key: "park_ride" }]);

    expect(Array.from(pruned.nodes.ids.sorted)).toEqual([1, 2, 3, 6]);
    expect(pruned.nodes.getById(3)?.tags).toEqual({ park_ride: "yes" });
    // Refs to nodes missing from the source are kept as they are.
    expect(pruned.ways.getById(10)?.refs).toEqual([1, 2, 99]);
    expect(pruned.relations.getById(20)?.members).toEqual([{ type: "node", ref: 6, role: "via" }]);
    expect(pruned.id).toBe("source");
  });

  it("returns the source when there are no rules or nothing to remove", () => {
    const source = buildStreetsOsm();
    expect(pruneUnreferencedNodes(source, [])).toBe(source);
    expect(pruneUnreferencedNodes(source, [{ key: "building" }, { key: "amenity" }])).not.toBe(
      source,
    );
    const everything = pruneUnreferencedNodes(source, [{ key: "park_ride" }, { key: "amenity" }]);
    expect(pruneUnreferencedNodes(everything, [{ key: "park_ride" }, { key: "amenity" }])).toBe(
      everything,
    );
  });
});

describe("Conveyal tag filters", () => {
  it("keep every street vertex, via nodes, and park and ride nodes", async () => {
    const osm = await fromPbf(
      await toPbfBuffer(buildStreetsOsm()),
      { extractTagFilter: CONVEYAL_EXTRACT_TAG_FILTERS },
      () => {},
    );

    expect(Array.from(osm.ways.ids.sorted)).toEqual([10, 11]);
    expect(Array.from(osm.relations.ids.sorted)).toEqual([30]);
    // Building nodes 5-7 and the bench (9) are gone.
    expect(Array.from(osm.nodes.ids.sorted)).toEqual([1, 2, 3, 4, 8, 11]);
    expect(osm.nodes.getById(4)?.tags).toEqual({ highway: "traffic_signals" });
    expect(osm.nodes.getById(8)?.tags).toEqual({ park_ride: "yes", name: "Lot" });
    expect(osm.ways.getCoordinates(osm.ways.ids.getIndexFromId(10))).toHaveLength(4);
    expect(osm.info().spatialIndexes.nodes.all).toBe(true);
  });

  it("keep complete ways under a complete_ways extract", async () => {
    const osm = await fromPbf(
      await toPbfBuffer(buildStreetsOsm()),
      {
        extractTagFilter: CONVEYAL_EXTRACT_TAG_FILTERS,
        extractBbox: [-0.0005, -0.0005, 0.0015, 0.0015],
        extractStrategy: "complete_ways",
      },
      () => {},
    );

    expect(Array.from(osm.ways.ids.sorted)).toEqual([10, 11]);
    expect(Array.from(osm.relations.ids.sorted)).toEqual([30]);
    expect(Array.from(osm.nodes.ids.sorted)).toEqual([1, 2, 3, 4, 11]);
  });

  it("drop a turn restriction that a simple extract cuts", async () => {
    const osm = await fromPbf(
      await toPbfBuffer(buildStreetsOsm()),
      {
        extractTagFilter: CONVEYAL_EXTRACT_TAG_FILTERS,
        extractBbox: [-0.0005, -0.0005, 0.0005, 0.0005],
        extractStrategy: "simple",
      },
      () => {},
    );

    expect(Array.from(osm.ways.ids.sorted)).toEqual([10]);
    expect(osm.relations.size).toBe(0);
    expect(Array.from(osm.nodes.ids.sorted)).toEqual([1]);
  });
});
