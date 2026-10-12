import { Osm } from "@osmix/core";
import type { OsmNode, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { applyPlan, planMerge, proposalTagChanges } from "../src/plan/plan.ts";
import { findProposal } from "./helpers/plan.ts";

/** Degrees per meter at the equator. */
const M = 1 / 111_320;
const quiet = () => {};
const drop = { dropImportedKeys: ["ext:*", "note"] } as const;

function osm(id: string, nodes: OsmNode[], ways: OsmWay[] = []) {
  const result = new Osm({ id });
  for (const node of nodes) result.nodes.addNode(node);
  for (const way of ways) result.ways.addWay(way);
  result.buildIndexes();
  result.buildSpatialIndexes();
  return result;
}

/** A base footway ending at node 1. */
const base = () =>
  osm(
    "base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0, lat: -0.001 },
    ],
    [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
  );

const kerb = { barrier: "kerb", kerb: "lowered", "ext:sw_id": "r_1", note: "survey" };

describe("dropImportedKeys (MP-X4)", () => {
  it("leaves dropped keys out of an identical-point merge, and keeps them on added features", () => {
    const patch = osm("patch", [
      { id: 101, lon: 0, lat: 0, tags: kerb },
      { id: 102, lon: 0.001, lat: 0.001, tags: { "ext:sw_id": "r_2", amenity: "bench" } },
    ]);
    const plan = planMerge(base(), patch, drop, quiet);
    expect(proposalTagChanges(plan, "exact:n101>n1")?.changes).toEqual([
      { key: "barrier", after: "kerb" },
      { key: "kerb", after: "lowered" },
    ]);
    const result = applyPlan(plan).osm;
    expect(result.nodes.getById(1)?.tags).toEqual({ barrier: "kerb", kerb: "lowered" });
    expect(result.nodes.getById(102)?.tags).toEqual({ "ext:sw_id": "r_2", amenity: "bench" });
  });

  it("leaves dropped keys out of a connection, and points that differ only in them agree", () => {
    // Two imported footways end 0.3 m north and east of node 1, with kerbs of different ext:sw_id.
    const patch = osm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0.3 * M, tags: kerb },
        { id: 102, lon: 0, lat: 0.001 },
        { id: 201, lon: 0.3 * M, lat: 0, tags: { ...kerb, "ext:sw_id": "r_9" } },
        { id: 202, lon: 0.001, lat: 0 },
      ],
      [
        { id: 20, refs: [101, 102], tags: { highway: "footway" } },
        { id: 30, refs: [201, 202], tags: { highway: "footway" } },
      ],
    );
    const matching = { propertyKeys: [], attachNetwork: true, maxDistanceMeters: 1 };
    const kept = planMerge(base(), patch, { matching }, quiet);
    expect(findProposal(kept, "connect:n101>n1").reasons).toEqual(["node-context-conflict"]);

    const plan = planMerge(base(), patch, { ...drop, matching }, quiet);
    for (const id of ["connect:n101>n1", "connect:n201>n1"]) {
      expect(findProposal(plan, id)).toMatchObject({ competitors: [], effect: "applied" });
    }
    const result = applyPlan(plan).osm;
    expect(result.nodes.getById(1)?.tags).toEqual({ barrier: "kerb", kerb: "lowered" });
    expect(result.ways.getById(20)?.refs).toEqual([1, 102]);
    expect(result.ways.getById(30)?.refs).toEqual([1, 202]);
  });

  it("leaves dropped keys out of a way reconcile", () => {
    const patch = osm(
      "patch",
      [],
      [{ id: 20, refs: [2, 1], tags: { highway: "footway", surface: "asphalt", "ext:id": "7" } }],
    );
    const plan = planMerge(base(), patch, { ...drop, createIntersections: false }, quiet);
    expect(proposalTagChanges(plan, "reconcile:w20>w10")?.changes).toEqual([
      { key: "surface", after: "asphalt" },
    ]);
    expect(applyPlan(plan).osm.ways.getById(10)?.tags).toEqual({
      highway: "footway",
      surface: "asphalt",
    });
  });

  it("refuses a copy of a dropped key and a malformed entry", () => {
    const patch = osm("patch", [{ id: 101, lon: 0, lat: 0.3 * M, tags: kerb }]);
    expect(() =>
      planMerge(
        base(),
        patch,
        { ...drop, matching: { propertyKeys: ["kerb", "ext:sw_id"], attachNetwork: false } },
        quiet,
      ),
    ).toThrow("matching.propertyKeys selects ext:sw_id, which dropImportedKeys drops");
    expect(() => planMerge(base(), patch, { dropImportedKeys: ["ext:*:id"] }, quiet)).toThrow(
      'dropImportedKeys entry "ext:*:id" must be a key or a prefix ending in *',
    );
  });
});
