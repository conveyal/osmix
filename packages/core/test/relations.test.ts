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

describe("relation way membership cache", () => {
  it("returns an empty cached set for empty relations", () => {
    const osm = new Osm();

    const first = osm.relations.getWayMemberIds();
    const second = osm.relations.getWayMemberIds();

    expect(first).toBe(second);
    expect(first).toEqual(new Set());
  });

  it("collects unique direct and nested way members", () => {
    const wayIds = createOsmWithRelations().relations.getWayMemberIds();

    expect(wayIds).toEqual(new Set([10, 20]));
  });

  it("does not traverse relations again while the cache is warm", () => {
    const osm = createOsmWithRelations();
    const getByIndex = vi.spyOn(osm.relations, "getByIndex");

    const first = osm.relations.getWayMemberIds();
    const callsAfterFirstLookup = getByIndex.mock.calls.length;
    const second = osm.relations.getWayMemberIds();

    expect(second).toBe(first);
    expect(callsAfterFirstLookup).toBeGreaterThan(0);
    expect(getByIndex).toHaveBeenCalledTimes(callsAfterFirstLookup);
  });

  it("invalidates the cache when a relation is added", () => {
    const osm = new Osm();
    osm.relations.addRelation({ id: 1, members: [{ type: "way", ref: 10, role: "" }] });
    const first = osm.relations.getWayMemberIds();

    osm.relations.addRelation({ id: 2, members: [{ type: "way", ref: 20, role: "" }] });
    const second = osm.relations.getWayMemberIds();

    expect(second).not.toBe(first);
    expect(second).toEqual(new Set([10, 20]));
  });

  it("invalidates the cache when relations are added in bulk", () => {
    const osm = new Osm();
    osm.stringTable.add("");
    osm.relations.addRelation({ id: 1, members: [{ type: "way", ref: 10, role: "" }] });
    osm.relations.getWayMemberIds();

    osm.relations.addRelations(
      [{ id: 2, keys: [], vals: [], memids: [20], roles_sid: [0], types: [1] }],
      new Uint32Array([0]),
    );

    expect(osm.relations.getWayMemberIds()).toEqual(new Set([10, 20]));
  });

  it("starts with an empty cache after transfer and reconstruction", () => {
    const source = createOsmWithRelations();
    const reconstructed = new Osm(source);
    const getByIndex = vi.spyOn(reconstructed.relations, "getByIndex");

    const first = reconstructed.relations.getWayMemberIds();
    const callsAfterFirstLookup = getByIndex.mock.calls.length;
    const second = reconstructed.relations.getWayMemberIds();

    expect(first).toEqual(new Set([10, 20]));
    expect(second).toBe(first);
    expect(callsAfterFirstLookup).toBeGreaterThan(0);
    expect(getByIndex).toHaveBeenCalledTimes(callsAfterFirstLookup);
  });
});
