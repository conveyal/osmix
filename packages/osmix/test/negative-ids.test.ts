import { describe, expect, it } from "vitest";

import { fromPbf, Osm, renumberNegativeIds, toPbfBuffer } from "../src/index.ts";

function entities(osm: Osm) {
  return {
    nodes: [...osm.nodes.sorted()],
    ways: [...osm.ways.sorted()],
    relations: [...osm.relations.sorted()],
  };
}

/** IDs and refs on both sides of zero, so every delta-encoded run crosses it. */
function mixedIds() {
  const osm = new Osm({ id: "mixed-ids" });
  for (const [index, id] of [-3, -2, -1, 1, 2, 3].entries()) {
    osm.nodes.addNode({
      id,
      lon: index * 0.001,
      lat: 0,
      ...(id === -2 ? { tags: { a: "b" } } : {}),
    });
  }
  osm.ways.addWay({ id: -2, refs: [-3, 1, -2, 2], tags: { highway: "footway" } });
  osm.ways.addWay({ id: -1, refs: [3, -1], tags: { highway: "footway" } });
  osm.ways.addWay({ id: 4, refs: [1, 2, 3], tags: { highway: "footway" } });
  osm.relations.addRelation({
    id: -5,
    members: [
      { type: "way", ref: -2, role: "" },
      { type: "way", ref: 4, role: "" },
      { type: "node", ref: -3, role: "stop" },
      { type: "node", ref: 3, role: "stop" },
    ],
    tags: { type: "route" },
  });
  osm.relations.addRelation({ id: 6, members: [{ type: "relation", ref: -5, role: "" }] });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("negative IDs in PBF export", () => {
  it("round-trips negative and positive IDs, refs and members unchanged", async () => {
    const osm = mixedIds();
    const loaded = await fromPbf(await toPbfBuffer(osm), { id: "reloaded" });
    expect(entities(loaded)).toEqual(entities(osm));
  });

  it("exports only positive IDs after renumbering, with references intact", async () => {
    const { osm, idMap } = renumberNegativeIds(mixedIds());
    const loaded = await fromPbf(await toPbfBuffer(osm), { id: "renumbered" });
    expect(entities(loaded)).toEqual(entities(osm));
    const all = [...loaded.nodes, ...loaded.ways, ...loaded.relations];
    expect(all.every((entity) => entity.id > 0)).toBe(true);
    expect(loaded.ways.getById(idMap.ways[-2]!)?.refs).toEqual([
      idMap.nodes[-3],
      1,
      idMap.nodes[-2],
      2,
    ]);
    expect(loaded.relations.getById(6)?.members[0]?.ref).toBe(idMap.relations[-5]);
  });
});
