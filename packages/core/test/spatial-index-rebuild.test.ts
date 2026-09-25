import { describe, expect, it } from "vitest";

import { Osm } from "../src/osm.ts";

function buildIndexedOsm() {
  const osm = new Osm();
  osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
  osm.nodes.addNode({ id: 2, lon: 1, lat: 1 });
  osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "path" } });
  osm.relations.addRelation({
    id: 100,
    members: [{ type: "way", ref: 10, role: "" }],
    tags: { type: "route" },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("spatial index rebuilds", () => {
  it("reuses built way and relation indexes", () => {
    const osm = buildIndexedOsm();
    const waysIndex = osm.ways.buildSpatialIndex();
    const relationsIndex = osm.relations.buildSpatialIndex();

    osm.buildSpatialIndexes();

    expect(osm.ways.buildSpatialIndex()).toBe(waysIndex);
    expect(osm.relations.buildSpatialIndex()).toBe(relationsIndex);
    expect(osm.ways.intersects([-1, -1, 2, 2])).toEqual([0]);
    expect(osm.relations.intersects([-1, -1, 2, 2])).toEqual([0]);
  });
});
