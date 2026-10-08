import { Osm } from "@osmix/core";
import type { OsmNode, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { planMerge, proposalTagChanges } from "../src/plan/plan.ts";

const quiet = () => {};

function dataset(id: string, nodes: OsmNode[], ways: OsmWay[] = []) {
  const osm = new Osm({ id });
  for (const node of nodes) osm.nodes.addNode(node);
  for (const way of ways) osm.ways.addWay(way);
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

const base = () =>
  dataset(
    "base",
    [
      { id: 1, lon: 0, lat: 0, tags: { kerb: "lowered", name: "Corner" } },
      { id: 2, lon: 0.001, lat: 0 },
      { id: 3, lon: 0.0005, lat: -0.0005 },
      { id: 4, lon: 0.0005, lat: 0.0005 },
    ],
    [
      { id: 10, refs: [1, 2], tags: { highway: "residential" } },
      { id: 11, refs: [3, 4], tags: { highway: "residential" } },
    ],
  );

describe("proposalTagChanges", () => {
  it("shows what an identical-point merge does to the base point, decided or not", () => {
    const patch = dataset("patch", [
      { id: -1, lon: 0, lat: 0, tags: { kerb: "raised", tactile_paving: "yes" } },
    ]);
    // Imported values win (MP-X1); the base point keeps the rest.
    const expected = {
      entity: { type: "node", id: 1 },
      changes: [
        { key: "kerb", before: "lowered", after: "raised" },
        { key: "tactile_paving", after: "yes" },
      ],
      unchanged: 1,
    };
    const automatic = planMerge(base(), patch, {}, quiet);
    expect(proposalTagChanges(automatic, "exact:n-1>n1")).toEqual(expected);
    const waiting = planMerge(base(), patch, { mergeIdenticalPoints: false }, quiet);
    expect(waiting.proposals.get("exact:n-1>n1")?.effect).toBe("needs-decision");
    expect(proposalTagChanges(waiting, "exact:n-1>n1")).toEqual(expected);
  });

  it("replaces a same-ID entity's tags, and adds or connects without changing any", () => {
    const patch = dataset(
      "patch",
      [
        { id: 2, lon: 0.001, lat: 0, tags: { crossing: "marked" } },
        { id: -1, lon: 0.002, lat: 0.002 },
      ],
      [{ id: -1, refs: [-1, 2], tags: { highway: "footway" } }],
    );
    const plan = planMerge(base(), patch, { createIntersections: false }, quiet);
    expect(proposalTagChanges(plan, "replace:n2")).toEqual({
      entity: { type: "node", id: 2 },
      changes: [{ key: "crossing", after: "marked" }],
      unchanged: 0,
    });
    expect(proposalTagChanges(plan, "add:w-1")).toBeNull();
    expect(() => proposalTagChanges(plan, "add:w-99")).toThrow("Unknown plan proposal add:w-99");
  });

  it("creates a crossing node with crossing=yes", () => {
    const patch = dataset(
      "patch",
      [
        { id: -1, lon: 0.0003, lat: -0.0005 },
        { id: -2, lon: 0.0003, lat: 0.0005 },
      ],
      [{ id: -1, refs: [-1, -2], tags: { highway: "footway" } }],
    );
    const plan = planMerge(base(), patch, {}, quiet);
    const crossing = [...plan.proposals.values()].find(({ kind }) => kind === "crossing-node");
    if (!crossing) throw Error("Expected a crossing node");
    expect(proposalTagChanges(plan, crossing.id)).toEqual({
      entity: null,
      changes: [{ key: "crossing", after: "yes" }],
      unchanged: 0,
    });
  });

  it("copies only the selected tags that differ onto the base point", () => {
    const patch = dataset(
      "patch",
      [
        { id: -5, lon: 0.000004, lat: 0, tags: { kerb: "flush", name: "Ignored" } },
        { id: -6, lon: 0.000004, lat: 0.001 },
      ],
      [{ id: -1, refs: [-5, -6], tags: { highway: "footway" } }],
    );
    const plan = planMerge(
      base(),
      patch,
      { matching: { propertyKeys: ["kerb"], attachNetwork: false } },
      quiet,
    );
    const copy = [...plan.proposals.values()].find(({ kind }) => kind === "copy-tags");
    if (!copy) throw Error("Expected a copy proposal");
    expect(proposalTagChanges(plan, copy.id)).toEqual({
      entity: { type: "node", id: 1 },
      changes: [{ key: "kerb", before: "lowered", after: "flush" }],
      unchanged: 1,
    });
  });
});
