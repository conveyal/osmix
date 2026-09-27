import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { merge } from "../src/merge.ts";
import { applyPlan, generateMergePlanOsc, planMerge } from "../src/plan/plan.ts";

const quiet = () => {};

function dataset(id: string, nodes: OsmNode[], ways: OsmWay[] = [], relations: OsmRelation[] = []) {
  const osm = new Osm({ id });
  for (const node of nodes) osm.nodes.addNode(node);
  for (const way of ways) osm.ways.addWay(way);
  for (const relation of relations) osm.relations.addRelation(relation);
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function baseRoad() {
  return dataset(
    "base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0.001, lat: 0 },
    ],
    [{ id: 10, refs: [1, 2], tags: { highway: "residential" } }],
  );
}

/** An import numbered from -1, with one edit of base node 2. */
function importedPath() {
  return dataset(
    "patch",
    [
      { id: -1, lon: 0, lat: 0.001 },
      { id: -2, lon: 0.001, lat: 0.001 },
      { id: -3, lon: 0.002, lat: 0.002, tags: { amenity: "bench" } },
      { id: 2, lon: 0.001, lat: 0, tags: { crossing: "marked" } },
    ],
    [{ id: -1, refs: [-1, -2, 2], tags: { highway: "footway" } }],
    [{ id: -1, members: [{ type: "way", ref: -1, role: "" }], tags: { type: "route" } }],
  );
}

describe("planMerge", () => {
  it("applies to the same dataset as a direct merge", async () => {
    const base = baseRoad();
    const patch = importedPath();
    const expected = await merge(base, patch, { directMerge: true }, quiet);
    const { osm } = applyPlan(planMerge(base, patch, {}, quiet));
    expect(osm.contentHash()).toBe(expected.contentHash());
  });

  it("groups the patch into features with stable proposal IDs", () => {
    const plan = planMerge(baseRoad(), importedPath(), {}, quiet);
    expect(
      plan.features.map(({ key, outcome, proposalIds, vertexIds }) => ({
        key,
        outcome,
        proposalIds,
        vertexIds,
      })),
    ).toEqual([
      {
        key: "way:-1",
        outcome: "replaced",
        proposalIds: ["add:w-1", "replace:n2"],
        vertexIds: [-1, -2, 2],
      },
      { key: "node:-3", outcome: "added", proposalIds: ["add:n-3"], vertexIds: undefined },
      { key: "relation:-1", outcome: "added", proposalIds: ["add:r-1"], vertexIds: undefined },
    ]);
    expect(plan.summary.replacesBase).toBe(1);
    expect(plan.summary.features).toMatchObject({ replaced: 1, added: 2, unchanged: 0 });
    expect(plan.idRemap).toEqual({ mode: "osm", remapped: 0 });
  });

  it("moves negative patch IDs below the base's lowest ID so imports never collide", () => {
    // The base already holds an earlier import numbered from -1.
    const base = dataset(
      "base",
      [
        { id: -2, lon: 1, lat: 1 },
        { id: -1, lon: 1.001, lat: 1 },
      ],
      [{ id: -1, refs: [-2, -1], tags: { highway: "footway", name: "Earlier import" } }],
    );
    const patch = importedPath();
    const plan = planMerge(base, patch, {}, quiet);
    const { osm } = applyPlan(plan);
    expect(osm.ways.getById(-1)?.tags?.["name"]).toBe("Earlier import");
    expect(osm.ways.getById(-2)?.refs).toEqual([-3, -4, 2]);
    expect(osm.relations.getById(-1)?.members).toEqual([{ type: "way", ref: -2, role: "" }]);
    expect(plan.features[0]).toMatchObject({ key: "way:-1", originalId: -1, id: -2 });
    // Three nodes and the way; the base has no relations, so relation -1 keeps its ID.
    expect(plan.idRemap).toEqual({ mode: "osm", remapped: 4 });
  });

  it("reads every patch ID as new when asked, so positive IDs replace nothing", () => {
    const base = baseRoad();
    const plan = planMerge(base, importedPath(), { patchIds: "new" }, quiet);
    const { osm } = applyPlan(plan);
    expect(plan.summary.replacesBase).toBe(0);
    expect(osm.nodes.getById(2)?.tags).toBeUndefined();
    expect(osm.nodes.size).toBe(base.nodes.size + 4);
    expect(plan.features[0]).toMatchObject({ outcome: "added", proposalIds: ["add:w-1"] });
  });

  it("writes the plan as osmChange without applying it", () => {
    const osc = generateMergePlanOsc(planMerge(baseRoad(), importedPath(), {}, quiet));
    expect(osc).toContain('<way id="-1"');
    expect(osc).toMatch(/<modify>.*<node id="2"/s);
  });

  it("refuses inputs without built indexes", () => {
    const unindexed = new Osm({ id: "unindexed" });
    expect(() => planMerge(unindexed, importedPath(), {}, quiet)).toThrow(
      "Build indexes for unindexed before planning a merge",
    );
  });
});
