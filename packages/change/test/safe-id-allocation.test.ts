import { Osm, type Osm as OsmType } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset";
import { OsmChangeset } from "../src/changeset";

function osmWithNodeIds(ids: number[], buildIndex = true): OsmType {
  const osm = new Osm({ id: "fixture" });
  for (const id of ids) osm.nodes.addNode({ id, lon: id, lat: id });
  if (buildIndex) osm.nodes.buildIndex();
  return osm;
}

describe("safe node ID allocation", () => {
  it.each([
    { name: "empty", ids: [], expected: 0 },
    { name: "ascending", ids: [1, 2, 3], expected: 4 },
    { name: "descending", ids: [3, 2, 1], expected: 4 },
    { name: "sparse", ids: [1, 100, 3], expected: 101 },
    { name: "negative", ids: [-8, -3, -5], expected: -2 },
  ])("allocates after the true maximum for $name IDs", ({ ids, expected }) => {
    const changeset = new OsmChangeset(osmWithNodeIds(ids));

    expect(changeset.nextNodeId()).toBe(expected);
  });

  it("scans insertion-order IDs when the index is not built", () => {
    const changeset = new OsmChangeset(osmWithNodeIds([9, 2, 14, 4], false));

    expect(changeset.nextNodeId()).toBe(15);
  });

  it("uses the true maximum across base and patch during direct generation", () => {
    const combinations = [
      { base: [], patch: [], expected: 0 },
      { base: [], patch: [12, 4], expected: 13 },
      { base: [8, 2], patch: [], expected: 9 },
      { base: [10], patch: [3, 17, 5], expected: 18 },
      { base: [-8], patch: [-12, -4], expected: -3 },
    ];

    for (const { base, patch, expected } of combinations) {
      const changeset = new OsmChangeset(osmWithNodeIds(base));
      changeset.generateDirectChanges(osmWithNodeIds(patch));

      expect(changeset.nextNodeId()).toBe(expected);
    }
  });

  it("allocates multiple nodes without collisions and preserves their refs", () => {
    const changeset = new OsmChangeset(osmWithNodeIds([100]));
    const nodeIds = [changeset.nextNodeId(), changeset.nextNodeId(), changeset.nextNodeId()];

    for (const [index, id] of nodeIds.entries()) {
      changeset.create({ id, lon: index, lat: index }, "generated");
    }
    changeset.create({ id: 200, refs: nodeIds, tags: { highway: "service" } }, "generated");
    changeset.create(
      {
        id: 300,
        members: nodeIds.map((ref) => ({ type: "node" as const, ref, role: "point" })),
        tags: { type: "route" },
      },
      "generated",
    );

    const result = applyChangesetToOsm(changeset);
    expect(result.nodes.ids.has(101)).toBe(true);
    expect(result.nodes.ids.has(102)).toBe(true);
    expect(result.nodes.ids.has(103)).toBe(true);
    expect(result.ways.getById(200)?.refs).toEqual(nodeIds);
    expect(result.relations.getById(300)?.members.map((member) => member.ref)).toEqual(nodeIds);
  });

  it("reports a collision instead of reusing an existing ID", () => {
    const changeset = new OsmChangeset(osmWithNodeIds([1, 3]));
    changeset.currentNodeId = 2;

    expect(() => changeset.nextNodeId()).toThrow("ID already exists");
  });

  it("rejects IDs outside the safe integer range", () => {
    const changeset = new OsmChangeset(osmWithNodeIds([]));
    changeset.currentNodeId = Number.MAX_SAFE_INTEGER;

    expect(() => changeset.nextNodeId()).toThrow("safe integer range");
  });
});
