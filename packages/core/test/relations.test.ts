import { describe, expect, it, vi } from "vitest";

import { Osm, type Osm as OsmType } from "../src/osm";

function createOsmWithRelations(): OsmType {
  const osm = new Osm({ id: "relations" });
  osm.nodes.addNode({ id: 1, lon: -120, lat: 46 });
  osm.nodes.addNode({ id: 2, lon: -120.01, lat: 46.01 });
  osm.nodes.addNode({ id: 3, lon: -120.02, lat: 46.02 });
  osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "primary" } });
  osm.ways.addWay({ id: 20, refs: [2, 3], tags: { highway: "secondary" } });
  osm.relations.addRelation({
    id: 100,
    members: [
      { type: "way", ref: 10, role: "outer" },
      { type: "node", ref: 1, role: "label" },
      { type: "way", ref: 10, role: "outer" },
    ],
  });
  osm.relations.addRelation({
    id: 200,
    members: [
      { type: "way", ref: 20, role: "outer" },
      { type: "relation", ref: 100, role: "child" },
    ],
  });
  osm.buildIndexes();
  return osm;
}

/** Way membership for every way in `osm`, as sorted way IDs. */
function wayMemberIds(osm: OsmType): number[] {
  const ids: number[] = [];
  for (let i = 0; i < osm.ways.size; i++) {
    if (osm.relations.isWayMember(i)) ids.push(osm.ways.ids.at(i));
  }
  return ids.sort((a, b) => a - b);
}

/** Osm with ways 10, 20 and 30 and no relations. */
function createOsmWithWays(): OsmType {
  const osm = new Osm();
  osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
  for (const id of [10, 20, 30]) osm.ways.addWay({ id, refs: [1] });
  return osm;
}

describe("relation way membership cache", () => {
  it("reports no members when there are no relations", () => {
    const osm = createOsmWithWays();
    osm.buildIndexes();

    expect(wayMemberIds(osm)).toEqual([]);
  });

  it("collects unique direct and nested way members", () => {
    expect(wayMemberIds(createOsmWithRelations())).toEqual([10, 20]);
  });

  it("does not traverse relations again while the cache is warm", () => {
    const osm = createOsmWithRelations();
    const getByIndex = vi.spyOn(osm.relations, "getByIndex");

    osm.relations.isWayMember(0);
    const callsAfterFirstLookup = getByIndex.mock.calls.length;
    osm.relations.isWayMember(1);

    expect(callsAfterFirstLookup).toBeGreaterThan(0);
    expect(getByIndex).toHaveBeenCalledTimes(callsAfterFirstLookup);
  });

  // Relations cannot be added after their ID index is built, so these tests only index nodes and
  // ways. Membership resolution without nested relations never consults the relation ID index.
  it("invalidates the cache when a relation is added", () => {
    const osm = createOsmWithWays();
    osm.nodes.buildIndex();
    osm.ways.buildIndex();
    osm.relations.addRelation({ id: 1, members: [{ type: "way", ref: 10, role: "" }] });
    expect(wayMemberIds(osm)).toEqual([10]);

    osm.relations.addRelation({ id: 2, members: [{ type: "way", ref: 20, role: "" }] });

    expect(wayMemberIds(osm)).toEqual([10, 20]);
  });

  it("invalidates the cache when relations are added in bulk", () => {
    const osm = createOsmWithWays();
    osm.stringTable.add("");
    osm.nodes.buildIndex();
    osm.ways.buildIndex();
    osm.relations.addRelation({ id: 1, members: [{ type: "way", ref: 10, role: "" }] });
    expect(wayMemberIds(osm)).toEqual([10]);

    osm.relations.addRelations(
      [{ id: 2, keys: [], vals: [], memids: [20], roles_sid: [0], types: [1] }],
      new Uint32Array([0]),
    );

    expect(wayMemberIds(osm)).toEqual([10, 20]);
  });

  it("ignores way members that are not in the dataset", () => {
    const osm = createOsmWithWays();
    osm.relations.addRelation({
      id: 1,
      members: [
        { type: "way", ref: 30, role: "" },
        { type: "way", ref: 99, role: "" },
      ],
    });
    osm.buildIndexes();

    expect(wayMemberIds(osm)).toEqual([30]);
  });

  it("starts with an empty cache after transfer and reconstruction", () => {
    const source = createOsmWithRelations();
    const reconstructed = new Osm(source);
    const getByIndex = vi.spyOn(reconstructed.relations, "getByIndex");

    expect(wayMemberIds(reconstructed)).toEqual([10, 20]);
    expect(getByIndex.mock.calls.length).toBeGreaterThan(0);
  });
});
