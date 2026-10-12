import { describe, expect, it } from "vitest";

import { Osm } from "../src/osm.ts";
import { renumberNegativeIds } from "../src/renumber.ts";

function mixedIds() {
  const osm = new Osm({ id: "mixed" });
  osm.nodes.addNode({ id: 5, lon: 0, lat: 0 });
  osm.nodes.addNode({ id: -1, lon: 0.001, lat: 0, tags: { name: "New entrance" } });
  osm.nodes.addNode({ id: -2, lon: 0.002, lat: 0 });
  osm.ways.addWay({ id: 7, refs: [5, -1], tags: { highway: "footway" } });
  osm.ways.addWay({ id: -3, refs: [-1, -2], tags: { highway: "footway" } });
  osm.relations.addRelation({
    id: -1,
    members: [
      { type: "node", ref: -2, role: "stop" },
      { type: "way", ref: -3, role: "" },
      { type: "way", ref: 7, role: "" },
    ],
    tags: { type: "route" },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("renumberNegativeIds", () => {
  it("gives each type's negative IDs new ones after its highest ID and follows every reference", () => {
    const input = mixedIds();
    const { osm, idMap } = renumberNegativeIds(input);
    expect(idMap).toEqual({
      nodes: { "-1": 6, "-2": 7 },
      ways: { "-3": 8 },
      relations: { "-1": 1 },
    });
    expect(osm.nodes.getById(6)?.tags).toEqual({ name: "New entrance" });
    expect(osm.ways.getById(7)?.refs).toEqual([5, 6]);
    expect(osm.ways.getById(8)?.refs).toEqual([6, 7]);
    expect(osm.relations.getById(1)?.members.map((member) => member.ref)).toEqual([7, 8, 7]);
    expect([...osm.nodes].every((node) => node.id > 0)).toBe(true);
    // The input keeps its IDs.
    expect(input.nodes.getById(-1)).not.toBeNull();
  });

  it("is deterministic and a no-op without negative IDs", () => {
    expect(renumberNegativeIds(mixedIds()).idMap).toEqual(renumberNegativeIds(mixedIds()).idMap);
    const positive = new Osm({ id: "positive" });
    positive.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    positive.buildIndexes();
    const { osm, idMap } = renumberNegativeIds(positive);
    expect(idMap).toEqual({ nodes: {}, ways: {}, relations: {} });
    expect([...osm.nodes]).toEqual([...positive.nodes]);
  });
});
