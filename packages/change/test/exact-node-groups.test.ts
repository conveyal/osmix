import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmTags, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset.ts";
import { OsmChangeset } from "../src/changeset.ts";
import { generateChangeset } from "../src/generate-changeset.ts";

function dataset(id: string, nodes: OsmNode[], ways: OsmWay[] = [], relations: OsmRelation[] = []) {
  const osm = new Osm({ id });
  for (const node of nodes) osm.nodes.addNode(node);
  for (const way of ways) osm.ways.addWay(way);
  for (const relation of relations) osm.relations.addRelation(relation);
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function reconcile(base: Osm, patch: Osm) {
  return generateChangeset(base, patch, { directMerge: true, deduplicateNodes: true }, () => {});
}

describe("exact node replacement groups", () => {
  it.each([
    { cafeId: 101, schoolId: 102, reverse: false },
    { cafeId: 101, schoolId: 102, reverse: true },
    { cafeId: 102, schoolId: 101, reverse: false },
    { cafeId: 102, schoolId: 101, reverse: true },
  ])("retains conflicting imports regardless of order: %o", ({ cafeId, schoolId, reverse }) => {
    const base = dataset("base", [{ id: 1, lon: 0, lat: 0 }]);
    const nodes: OsmNode[] = [
      { id: cafeId, lon: 0, lat: 0, tags: { amenity: "cafe", name: "Cafe" } },
      { id: schoolId, lon: 0, lat: 0, tags: { amenity: "school", name: "School" } },
      { id: 103, lon: 0, lat: 1 },
      { id: 104, lon: 1, lat: 0 },
    ];
    const ways: OsmWay[] = [
      { id: 10, refs: [cafeId, 103], tags: { highway: "footway" } },
      { id: 20, refs: [schoolId, 104], tags: { highway: "footway" } },
    ];
    const relations: OsmRelation[] = [
      {
        id: 30,
        members: [
          { type: "node", ref: cafeId, role: "label" },
          { type: "node", ref: schoolId, role: "entrance" },
          { type: "way", ref: 10, role: "" },
          { type: "way", ref: 20, role: "" },
        ],
      },
    ];
    const patch = dataset("patch", reverse ? nodes.toReversed() : nodes, ways, relations);
    const changeset = reconcile(base, patch);
    const result = applyChangesetToOsm(changeset);

    expect(changeset.stats.deduplicatedNodes).toBe(0);
    expect(changeset.stats.deduplicatedNodesReplaced).toBe(0);
    expect(result.nodes.getById(1)).toEqual(base.nodes.getById(1));
    for (const node of nodes) expect(result.nodes.getById(node.id)).toEqual(node);
    for (const way of ways) expect(result.ways.getById(way.id)).toEqual(way);
    expect(result.relations.getById(30)).toEqual(relations[0]);
  });

  it("declines the whole conflicting group while accepting an independent compatible group", () => {
    const base = dataset("base", [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 1, lat: 0 },
    ]);
    const patch = dataset("patch", [
      { id: 101, lon: 0, lat: 0, tags: { amenity: "cafe" } },
      { id: 102, lon: 0, lat: 0 },
      { id: 103, lon: 0, lat: 0, tags: { amenity: "school" } },
      { id: 104, lon: 0, lat: 0, tags: { amenity: "cafe" } },
      { id: 105, lon: 1, lat: 0, tags: { amenity: "cafe" } },
      { id: 106, lon: 1, lat: 0, tags: { name: "Compatible cafe" } },
    ]);
    const changeset = reconcile(base, patch);
    const result = applyChangesetToOsm(changeset);

    expect(changeset.stats.deduplicatedNodes).toBe(2);
    expect(result.nodes.getById(1)).toEqual(base.nodes.getById(1));
    for (const id of [101, 102, 103, 104]) {
      expect(result.nodes.getById(id)).toEqual(patch.nodes.getById(id));
    }
    expect(result.nodes.getById(2)?.tags).toEqual({ amenity: "cafe", name: "Compatible cafe" });
    expect(result.nodes.ids.has(105)).toBe(false);
    expect(result.nodes.ids.has(106)).toBe(false);
  });

  it.each<OsmTags>([
    { highway: "footway", layer: "1", bridge: "yes" },
    { highway: "footway", access: "no" },
    { waterway: "stream" },
  ])("compares imported incident-way context across the group: %o", (conflictingTags) => {
    const base = dataset("base", [{ id: 1, lon: 0, lat: 0 }]);
    const patch = dataset(
      "patch",
      [
        { id: 101, lon: 0, lat: 0 },
        { id: 102, lon: 0, lat: 0 },
        { id: 103, lon: 0, lat: 1 },
        { id: 104, lon: 1, lat: 0 },
      ],
      [
        { id: 10, refs: [101, 103], tags: { highway: "footway", access: "yes" } },
        { id: 20, refs: [102, 104], tags: conflictingTags },
      ],
    );
    const changeset = reconcile(base, patch);
    const result = applyChangesetToOsm(changeset);

    expect(changeset.stats.deduplicatedNodes).toBe(0);
    expect(result.ways.getById(10)?.refs).toEqual([101, 103]);
    expect(result.ways.getById(20)?.refs).toEqual([102, 104]);
    expect(result.nodes.ids.has(101)).toBe(true);
    expect(result.nodes.ids.has(102)).toBe(true);
  });

  it("also rejects incompatible transitive groups in explicit same-dataset diagnostics", () => {
    const osm = dataset("diagnostic", [
      { id: 1, lon: 0, lat: 0, tags: { amenity: "cafe" } },
      { id: 2, lon: 0, lat: 0 },
      { id: 3, lon: 0, lat: 0, tags: { amenity: "school" } },
    ]);
    const changeset = new OsmChangeset(osm);
    expect(changeset.deduplicateNodes(osm.nodes)).toEqual(new Map());
    const result = applyChangesetToOsm(changeset);
    expect([...result.nodes]).toEqual([...osm.nodes]);
  });
});
