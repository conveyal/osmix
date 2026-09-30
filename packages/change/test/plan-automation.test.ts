import { Osm } from "@osmix/core";
import type { OsmNode, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { planMerge, setMergePlanDecisions } from "../src/plan/plan.ts";
import type { MergePlanAutomation, MergePlanOptions } from "../src/plan/types.ts";
import { findProposal } from "./helpers/plan.ts";

/** Degrees of latitude or longitude (at the equator) per meter. */
const M = 1 / 111_320;

function osm(id: string, nodes: OsmNode[], ways: OsmWay[]) {
  const result = new Osm({ id });
  for (const node of nodes) result.nodes.addNode(node);
  for (const way of ways) result.ways.addWay(way);
  result.buildIndexes();
  result.buildSpatialIndexes();
  return result;
}

/** A base footway ending at node 1, running south. */
function base() {
  return osm(
    "base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0, lat: -0.001 },
    ],
    [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
  );
}

/** An imported footway running north from node 1, with two vertices `a` and `b` m from it. */
function sameWay(a: number, b: number) {
  return osm(
    "patch",
    [
      { id: 101, lon: 0, lat: a * M },
      { id: 102, lon: 0, lat: b * M },
      { id: 103, lon: 0, lat: 0.001 },
    ],
    [{ id: 20, refs: [101, 102, 103], tags: { highway: "footway" } }],
  );
}

/** Two imported footways ending 0.1 m north and 0.7 m east of node 1. */
function twoWays() {
  return osm(
    "patch",
    [
      { id: 101, lon: 0, lat: 0.1 * M },
      { id: 102, lon: 0, lat: 0.001 },
      { id: 201, lon: 0.7 * M, lat: 0 },
      { id: 202, lon: 0.001, lat: 0 },
    ],
    [
      { id: 20, refs: [101, 102], tags: { highway: "footway" } },
      { id: 30, refs: [201, 202], tags: { highway: "footway" } },
    ],
  );
}

const matching: NonNullable<MergePlanOptions["matching"]> = {
  propertyKeys: ["kerb"],
  attachNetwork: true,
  maxDistanceMeters: 1,
};

function plan(patch: Osm, automation?: MergePlanAutomation, extra: MergePlanOptions = {}) {
  return planMerge(base(), patch, { matching, ...extra, ...(automation ? { automation } : {}) });
}

const decisionOf = (planned: ReturnType<typeof plan>, id: string) => {
  const proposal = findProposal(planned, id);
  return { decision: proposal.decision, automated: proposal.automated ?? false };
};

describe("automation levels (MP-M6)", () => {
  it("settles points of one imported way competing for one base point by a clear margin", () => {
    for (const level of [undefined, "recommended", "aggressive"] as const) {
      const planned = plan(sameWay(0.1, 0.7), level);
      expect(decisionOf(planned, "connect:n101>n1")).toEqual({
        decision: "accept",
        automated: true,
      });
      expect(decisionOf(planned, "connect:n102>n1")).toEqual({
        decision: "reject",
        automated: true,
      });
      expect(planned.summary.automated).toBe(2);
      expect(planned.summary.features["needs-decision"]).toBe(0);
    }
  });

  it("leaves everything in review when conservative", () => {
    const planned = plan(sameWay(0.1, 0.7), "conservative");
    expect(planned.options.matching?.automatic).toBe("none");
    expect(planned.summary.automated).toBe(0);
    expect(findProposal(planned, "connect:n101>n1").effect).toBe("needs-decision");
  });

  it("leaves a near tie for a person", () => {
    const planned = plan(sameWay(0.4, 0.6), "aggressive");
    expect(planned.summary.automated).toBe(0);
    expect(planned.summary.features["needs-decision"]).toBe(1);
  });

  it("settles competing imported features only when aggressive", () => {
    expect(plan(twoWays(), "recommended").summary.automated).toBe(0);
    const aggressive = plan(twoWays(), "aggressive");
    expect(decisionOf(aggressive, "connect:n101>n1").decision).toBe("accept");
    // Leaving the farther feature out is safe even though it bends away (bearing mismatch).
    expect(decisionOf(aggressive, "connect:n201>n1").decision).toBe("reject");
  });

  it("never replaces a person's choice, and a rival they left out still competes", () => {
    const leftOut = plan(sameWay(0.1, 0.7), "recommended", {
      decisions: [{ proposalId: "connect:n101>n1", action: "reject" }],
    });
    expect(decisionOf(leftOut, "connect:n101>n1")).toEqual({
      decision: "reject",
      automated: false,
    });
    // The farther point does not beat the nearer one the person left out, so it waits.
    expect(findProposal(leftOut, "connect:n102>n1").effect).toBe("needs-decision");

    const chosen = plan(sameWay(0.1, 0.7), "recommended", {
      decisions: [{ proposalId: "connect:n102>n1", action: "accept" }],
    });
    expect(decisionOf(chosen, "connect:n102>n1")).toEqual({ decision: "accept", automated: false });
    expect(findProposal(chosen, "connect:n101>n1").decision).toBeUndefined();
  });

  it("keeps its decisions through a replan and gives way to a new choice (MP-P4)", () => {
    const planned = plan(sameWay(0.1, 0.7), "recommended");
    setMergePlanDecisions(planned, [{ proposalId: "connect:n102>n1", action: "accept" }]);
    expect(findProposal(planned, "connect:n101>n1").decision).toBeUndefined();
    expect(findProposal(planned, "connect:n102>n1").effect).toBe("applied");
    setMergePlanDecisions(planned, []);
    expect(decisionOf(planned, "connect:n101>n1")).toEqual({
      decision: "accept",
      automated: true,
    });
    expect(planned.options.decisions).toEqual([]);
  });

  it("copies routing-affecting tags only when aggressive", () => {
    const patch = osm("patch", [{ id: 101, lon: 0.2 * M, lat: 0, tags: { kerb: "lowered" } }], []);
    const recommended = plan(patch, "recommended");
    expect(findProposal(recommended, "copy:n101>n1")).toMatchObject({
      status: "review",
      reasons: ["routing-property"],
      effect: "needs-decision",
    });
    expect(findProposal(plan(patch, "aggressive"), "copy:n101>n1")).toMatchObject({
      decision: "accept",
      automated: true,
      effect: "applied",
    });
  });

  it("never decides a removal (MP-R1)", () => {
    const patch = osm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0.4 * M },
        { id: 102, lon: 0, lat: -0.001 + 0.4 * M },
      ],
      [{ id: 20, refs: [102, 101], tags: { highway: "footway" } }],
    );
    const planned = plan(patch, "aggressive", {
      matching: { ...matching, allowWayRemoval: true },
    });
    const removals = [...planned.proposals.values()].filter(({ kind }) => kind === "remove-way");
    expect(removals.length).toBeGreaterThan(0);
    for (const removal of removals) expect(removal.decision).toBeUndefined();
  });
});
