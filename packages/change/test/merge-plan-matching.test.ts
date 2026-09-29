import { Osm } from "@osmix/core";
import type { OsmNode, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { getMergePlanCandidate, planMerge } from "../src/plan/plan.ts";
import type { MergePlanOptions } from "../src/plan/types.ts";
import { findProposal, planAndApply } from "./helpers/plan.ts";

function osm(id: string, nodes: OsmNode[], ways: OsmWay[]) {
  const result = new Osm({ id });
  for (const node of nodes) result.nodes.addNode(node);
  for (const way of ways) result.ways.addWay(way);
  result.buildIndexes();
  result.buildSpatialIndexes();
  return result;
}

/** A base sidewalk, and an imported copy about 0.45 m north with a branch off its far end. */
function sidewalks() {
  const base = osm(
    "base",
    [
      { id: 1, lon: 0, lat: 0, tags: { crossing: "marked" } },
      { id: 2, lon: 0.001, lat: 0 },
    ],
    [{ id: 10, refs: [1, 2], tags: { highway: "footway" } }],
  );
  const patch = osm(
    "patch",
    [
      { id: 101, lon: 0, lat: 0.000004, tags: { crossing: "marked" } },
      { id: 102, lon: 0.001, lat: 0.000004 },
      { id: 103, lon: 0.002, lat: 0.000004 },
    ],
    [
      { id: 20, refs: [101, 102], tags: { highway: "footway", name: "Harbour Walk" } },
      { id: 30, refs: [102, 103], tags: { highway: "footway" } },
    ],
  );
  return { base, patch };
}

const matching: NonNullable<MergePlanOptions["matching"]> = {
  propertyKeys: ["name"],
  attachNetwork: true,
  allowWayRemoval: true,
  automatic: "none",
};

describe("matching proposals", () => {
  it("proposes each matching action separately, with the candidate's evidence", () => {
    const { base, patch } = sidewalks();
    const plan = planMerge(base, patch, { matching }, () => {});
    expect(findProposal(plan, "connect:n102>n2")).toMatchObject({
      kind: "connect",
      status: "review",
      effect: "needs-decision",
      feature: "way:20",
    });
    expect(findProposal(plan, "copy:w20>w10")).toMatchObject({ kind: "copy-tags" });
    // Removal waits until the connections it depends on are accepted.
    expect(findProposal(plan, "remove:w20>w10")).toMatchObject({ status: "blocked" });
    expect(getMergePlanCandidate(plan, "connect:n102>n2")?.evidence.distanceMeters).toBeCloseTo(
      0.45,
      1,
    );
    expect(plan.summary.features["needs-decision"]).toBe(1);
    expect(plan.matching?.candidates.review).toBeGreaterThan(0);
  });

  it("applies accepted actions and removes the duplicate once its connections are accepted", () => {
    const { base, patch } = sidewalks();
    const { plan, osm: merged } = planAndApply(base, patch, {
      matching,
      decisions: [
        { proposalId: "connect:n101>n1", action: "accept" },
        { proposalId: "connect:n102>n2", action: "accept" },
        { proposalId: "copy:w20>w10", action: "accept" },
        { proposalId: "remove:w20>w10", action: "accept" },
      ],
    });
    const removal = findProposal(plan, "remove:w20>w10");
    expect(removal, JSON.stringify(removal)).toMatchObject({ status: "review", effect: "applied" });
    expect(plan.features.find((feature) => feature.key === "way:20")?.outcome).toBe("removed");
    expect(merged.ways.getById(20)).toBeNull();
    expect(merged.ways.getById(30)?.refs).toEqual([2, 103]);
    expect(merged.ways.getById(10)?.tags).toEqual({ highway: "footway", name: "Harbour Walk" });
    // A connection never merges tags, so the tagged imported point stays (MP-M2).
    expect(merged.nodes.getById(101)?.tags).toEqual({ crossing: "marked" });
    expect(plan.matching?.outcome).toBeDefined();
  });

  it("keeps a rejected connection separate and reports decisions it could not use", () => {
    const { base, patch } = sidewalks();
    const { plan, osm: merged } = planAndApply(base, patch, {
      matching,
      decisions: [
        { proposalId: "connect:n102>n2", action: "reject" },
        { proposalId: "connect:n999>n2", action: "accept" },
      ],
    });
    expect(findProposal(plan, "connect:n102>n2").effect).toBe("skipped");
    expect(merged.ways.getById(30)?.refs).toEqual([102, 103]);
    expect(plan.staleDecisions).toEqual(["connect:n999>n2"]);
  });

  it("lists the other targets for the same imported point as alternatives", () => {
    const { base, patch } = sidewalks();
    const twoTargets = osm(
      "base",
      [...base.nodes, { id: 3, lon: 0.001, lat: 0.000008 }],
      [...base.ways, { id: 11, refs: [3, 2], tags: { highway: "footway" } }],
    );
    const plan = planMerge(twoTargets, patch, { matching }, () => {});
    expect(findProposal(plan, "connect:n102>n2")).toMatchObject({
      alternatives: ["connect:n102>n3"],
    });
    expect(findProposal(plan, "connect:n102>n3")).toMatchObject({
      alternatives: ["connect:n102>n2"],
    });
  });

  it("refuses matching decisions outside the plan's decisions", () => {
    const { base, patch } = sidewalks();
    const options = { matching: { ...matching, decisions: [] } } as MergePlanOptions;
    expect(() => planMerge(base, patch, options, () => {})).toThrow(
      "Decide matching proposals with plan decisions, not matching.decisions",
    );
  });
});
