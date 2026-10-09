import { Osm } from "@osmix/core";
import type { OsmNode, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { merge } from "../src/merge.ts";
import { assessNodeIdentity, assessNodeTags } from "../src/rules/node-identity.ts";

function dataset(id: string, nodes: OsmNode[], ways: OsmWay[] = []) {
  const osm = new Osm({ id });
  for (const node of nodes) osm.nodes.addNode(node);
  for (const way of ways) osm.ways.addWay(way);
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

const exactMerge = (base: Osm, patch: Osm) =>
  merge(base, patch, { createIntersections: false }, () => {});

describe("node-identity rulebook", () => {
  it("compares node grade normalized, so equivalent spellings match", () => {
    expect(assessNodeTags({ covered: "false" }, {}).hardReasons).toEqual([]);
    expect(assessNodeTags({ layer: "1" }, {}).hardReasons).toContain("grade-conflict");
  });

  it("checks the full namespaced access list", () => {
    expect(assessNodeTags({ wheelchair: "yes" }, {}).hardReasons).toContain(
      "routing-family-conflict",
    );
    expect(assessNodeTags({ "access:conditional": "no" }, {}).hardReasons).toContain(
      "routing-family-conflict",
    );
  });

  it("lets an imported point's values win, and waits only on a change of grade", () => {
    expect(assessNodeTags({ a: "1" }, { a: "2" }).hardReasons).toContain("tag-conflict");
    const imported = { sourceIsImported: true };
    expect(assessNodeTags({ a: "1" }, { a: "2" }, imported)).toEqual({
      hardReasons: [],
      reviewReasons: [],
    });
    expect(
      assessNodeTags({ barrier: "kerb", kerb: "lowered" }, { barrier: "gate" }, imported),
    ).toEqual({ hardReasons: [], reviewReasons: [] });
    expect(assessNodeTags({ level: "1" }, {}, imported).reviewReasons).toEqual(["grade-change"]);
  });

  it("rejects a junction final validation would reject, and allows a portal", () => {
    const source: OsmNode = { id: 101, lon: 0, lat: 0 };
    const target: OsmNode = { id: 1, lon: 0, lat: 0 };
    const imported: OsmWay = { id: 20, refs: [101, 102], tags: { highway: "footway" } };
    const surfaceEnd: OsmWay = { id: 10, refs: [1, 2], tags: { highway: "footway" } };
    const levelThrough: OsmWay = {
      id: 11,
      refs: [3, 1, 4],
      tags: { highway: "footway", level: "1" },
    };
    expect(
      assessNodeIdentity("connect", source, target, [imported], [surfaceEnd, levelThrough])
        .hardReasons,
    ).toContain("grade-conflict");
    const surfaceThrough: OsmWay = { id: 10, refs: [3, 1, 4], tags: { highway: "footway" } };
    const levelEnd: OsmWay = { id: 11, refs: [1, 2], tags: { highway: "footway", level: "1" } };
    const continuation: OsmWay = { id: 12, refs: [1, 5], tags: { highway: "footway" } };
    expect(
      assessNodeIdentity(
        "connect",
        source,
        target,
        [imported],
        [surfaceThrough, levelEnd, continuation],
      ).hardReasons,
    ).toEqual([]);
  });
});

describe("exact reconciliation uses the rulebook", () => {
  it("merges an imported vertex whose way spells a default grade differently", async () => {
    const base = dataset(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
      ],
      [{ id: 10, refs: [1, 2], tags: { highway: "footway" } }],
    );
    const patch = dataset(
      "patch",
      [
        { id: 101, lon: 0, lat: 0 },
        { id: 102, lon: -0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway", covered: "false" } }],
    );
    const result = await exactMerge(base, patch);
    expect(result.ways.getById(20)?.refs).toEqual([1, 102]);
    expect(result.nodes.ids.has(101)).toBe(false);
  });

  it("adds an imported point's access tag to the base point it merges into", async () => {
    const base = dataset("base", [{ id: 1, lon: 0, lat: 0 }]);
    const patch = dataset("patch", [{ id: 101, lon: 0, lat: 0, tags: { wheelchair: "yes" } }]);
    const result = await exactMerge(base, patch);
    expect(result.nodes.ids.has(101)).toBe(false);
    expect(result.nodes.getById(1)?.tags).toEqual({ wheelchair: "yes" });
  });

  it("joins a footway into a junction that also has a private road", async () => {
    const base = dataset(
      "base",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0.001, lat: 0 },
        { id: 3, lon: 0, lat: 0.001 },
      ],
      [
        { id: 10, refs: [1, 2], tags: { highway: "footway" } },
        { id: 11, refs: [1, 3], tags: { highway: "service", access: "private" } },
      ],
    );
    const patch = dataset(
      "patch",
      [
        { id: 101, lon: 0, lat: 0 },
        { id: 102, lon: -0.001, lat: 0 },
      ],
      [{ id: 20, refs: [101, 102], tags: { highway: "footway" } }],
    );
    const result = await exactMerge(base, patch);
    expect(result.ways.getById(20)?.refs).toEqual([1, 102]);
  });
});
