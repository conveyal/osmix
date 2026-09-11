import { Osm } from "@osmix/core";

export function createBlockedBridgeFixture() {
  const base = new Osm({ id: "blocked-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0 });
  base.nodes.addNode({ id: 2, lon: 0.001, lat: 0 });
  base.nodes.buildIndex();
  base.ways.addWay({
    id: 10,
    refs: [1, 2],
    tags: { highway: "footway", name: "Ground path" },
  });
  base.buildIndexes();
  base.buildSpatialIndexes();

  const patch = new Osm({ id: "blocked-patch" });
  patch.nodes.addNode({ id: 11, lon: 0, lat: 0.000004 });
  patch.nodes.addNode({ id: 12, lon: 0.001, lat: 0.000004 });
  patch.nodes.buildIndex();
  patch.ways.addWay({
    id: 20,
    refs: [11, 12],
    tags: { highway: "footway", bridge: "yes", layer: "1", name: "Elevated path" },
  });
  patch.relations.addRelation({
    id: 30,
    members: [{ type: "way", ref: 20, role: "" }],
    tags: { type: "route", route: "foot", name: "Walking route" },
  });
  patch.buildIndexes();
  patch.buildSpatialIndexes();
  return { base, patch };
}

export function entitySnapshot(osm: Osm) {
  return {
    nodes: [...osm.nodes.sorted()],
    ways: [...osm.ways.sorted()],
    relations: [...osm.relations.sorted()],
  };
}
