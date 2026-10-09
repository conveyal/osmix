import { Osm } from "@osmix/core";
import type { OsmNode, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import {
  getMergePlanChoices,
  pickNearestMergePlanDecisions,
  planMerge,
  setMergePlanDecisions,
} from "../src/plan/plan.ts";
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

/**
 * An imported footway ending 0.1 m north of node 1, and one running east-west through a point
 * 0.7 m east of it: a point along a way at right angles to the base way, so it bends.
 */
function twoWays() {
  return osm(
    "patch",
    [
      { id: 101, lon: 0, lat: 0.1 * M },
      { id: 102, lon: 0, lat: 0.001 },
      { id: 203, lon: -0.001, lat: 0 },
      { id: 201, lon: 0.7 * M, lat: 0 },
      { id: 202, lon: 0.001, lat: 0 },
    ],
    [
      { id: 20, refs: [101, 102], tags: { highway: "footway" } },
      { id: 30, refs: [203, 201, 202], tags: { highway: "footway" } },
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

  it("lets points of different imported ways share a base point at every level (MP-M5)", () => {
    for (const level of ["recommended", "aggressive"] as const) {
      const planned = plan(twoWays(), level);
      expect(findProposal(planned, "connect:n101>n1")).toMatchObject({
        competitors: [],
        effect: "applied",
      });
      // Way 30's point waits only for its own reason: it bends onto the base way.
      expect(findProposal(planned, "connect:n201>n1")).toMatchObject({
        competitors: [],
        reasons: ["bearing-mismatch"],
        effect: "needs-decision",
      });
      expect(planned.summary.automated).toBe(0);
    }
  });

  it("leaves two points that give one base point different values to a person (MP-M5)", () => {
    // Imported footways end 0.1 m north and 0.3 m east of node 1, with different kerbs.
    const patch = osm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0.1 * M, tags: { barrier: "kerb", kerb: "lowered" } },
        { id: 102, lon: 0, lat: 0.001 },
        { id: 301, lon: 0.3 * M, lat: 0, tags: { barrier: "kerb", kerb: "raised" } },
        { id: 302, lon: 0.001, lat: 0 },
      ],
      [
        { id: 20, refs: [101, 102], tags: { highway: "footway" } },
        { id: 30, refs: [301, 302], tags: { highway: "footway" } },
      ],
    );
    for (const level of ["recommended", "aggressive"] as const) {
      const planned = plan(patch, level);
      expect(findProposal(planned, "connect:n101>n1")).toMatchObject({
        competitors: ["connect:n301>n1"],
        rivalries: { "connect:n301>n1": { conflictingKeys: ["kerb"] } },
        reasons: ["node-context-conflict"],
        effect: "needs-decision",
      });
      expect(findProposal(planned, "connect:n301>n1")).toMatchObject({
        competitors: ["connect:n101>n1"],
        effect: "needs-decision",
      });
      expect(planned.summary.automated).toBe(0);
    }
    const chosen = plan(patch, "aggressive", {
      decisions: [{ proposalId: "connect:n301>n1", action: "accept" }],
    });
    expect(findProposal(chosen, "connect:n301>n1").effect).toBe("applied");
    expect(findProposal(chosen, "connect:n101>n1").effect).toBe("needs-decision");
  });

  it("leaves a way reconcile that changes the base way's grade to a person at every level", () => {
    const patch = osm(
      "patch",
      [],
      [{ id: 20, refs: [2, 1], tags: { highway: "footway", bridge: "yes", layer: "1" } }],
    );
    for (const level of ["conservative", "recommended", "aggressive"] as const) {
      const planned = plan(patch, level, { createIntersections: false });
      expect(findProposal(planned, "reconcile:w20>w10")).toMatchObject({
        status: "review",
        reasons: ["grade-change"],
        effect: "needs-decision",
      });
    }
    const included = plan(patch, "recommended", {
      createIntersections: false,
      decisions: [{ proposalId: "reconcile:w20>w10", action: "accept" }],
    });
    expect(findProposal(included, "reconcile:w20>w10").effect).toBe("applied");
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

  it("never leaves a removal competing with a copy it settled", () => {
    // Two imported copies of base way 10. The automated copy's competing removal is blocked,
    // since any competition blocks removal, so nothing waits and nothing conflicts.
    const patch = osm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0.1 * M },
        { id: 102, lon: 0, lat: -0.001 + 0.1 * M },
        { id: 201, lon: 0.6 * M, lat: 0 },
        { id: 202, lon: 0.6 * M, lat: -0.001 },
      ],
      [
        { id: 20, refs: [102, 101], tags: { highway: "footway", name: "A" } },
        { id: 40, refs: [202, 201], tags: { highway: "footway", name: "B" } },
      ],
    );
    const planned = plan(patch, "aggressive", {
      matching: { ...matching, propertyKeys: ["name"], allowWayRemoval: true },
    });
    const removals = [...planned.proposals.values()].filter(({ kind }) => kind === "remove-way");
    expect(removals.length).toBeGreaterThan(0);
    for (const removal of removals) {
      expect(removal.status).toBe("blocked");
      expect(removal.reasons).toContain("many-to-one");
    }
    expect(planned.summary.features["needs-decision"]).toBe(0);
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

describe("choices that still wait (MP-M7)", () => {
  const sumsToNeedsDecision = (planned: ReturnType<typeof plan>) => {
    const { counts } = getMergePlanChoices(planned);
    const sum = Object.values(counts).reduce((total, count) => total + count, 0);
    expect(sum).toBe(planned.summary.features["needs-decision"]);
    return counts;
  };

  it("puts a near tie, a clear choice, a bend and a routing tag copy in their groups", () => {
    expect(sumsToNeedsDecision(plan(sameWay(0.4, 0.6), "recommended"))).toMatchObject({ tie: 1 });
    // Way 30 bends onto the base way; way 20 connects without a choice.
    expect(sumsToNeedsDecision(plan(twoWays(), "recommended"))).toMatchObject({
      nearest: 0,
      bend: 1,
    });
    const kerb = osm("patch", [{ id: 101, lon: 0.2 * M, lat: 0, tags: { kerb: "lowered" } }], []);
    expect(sumsToNeedsDecision(plan(kerb, "recommended"))).toMatchObject({ "routing-tags": 1 });
    expect(sumsToNeedsDecision(plan(sameWay(0.1, 0.7), "conservative"))).toMatchObject({
      nearest: 1,
    });
  });

  it("leaves a choice to a person when its clear winner bends sharply", () => {
    const patch = osm(
      "patch",
      [
        { id: 101, lon: 0, lat: 0.7 * M },
        { id: 102, lon: 0, lat: 0.001 },
        { id: 203, lon: -0.001, lat: 0 },
        { id: 201, lon: 0.1 * M, lat: 0 },
        { id: 204, lon: 0.7 * M, lat: 0 },
        { id: 202, lon: 0.001, lat: 0 },
      ],
      [{ id: 30, refs: [203, 201, 204, 202], tags: { highway: "footway" } }],
    );
    // Two points of one way compete for node 1; the nearer bends onto the base way.
    const planned = plan(patch, "aggressive");
    expect(findProposal(planned, "connect:n201>n1").reasons).toContain("bearing-mismatch");
    expect(findProposal(planned, "connect:n201>n1")).toMatchObject({
      competitors: ["connect:n204>n1"],
      // Both points are on imported way 30: connecting both would fold it onto node 1.
      rivalries: { "connect:n204>n1": { sharedWay: 30 } },
    });
    expect(sumsToNeedsDecision(planned)).toMatchObject({ nearest: 0, bend: 1 });
    expect(pickNearestMergePlanDecisions(planned, ["connect:n201>n1", "connect:n204>n1"])).toEqual(
      [],
    );
  });

  it("picks the clearly nearest as a person's decisions, like the aggressive level", () => {
    const planned = plan(sameWay(0.1, 0.7), "conservative");
    const { proposals } = getMergePlanChoices(planned);
    const nearest = [...proposals].filter(([, group]) => group === "nearest").map(([id]) => id);
    const decisions = pickNearestMergePlanDecisions(planned, nearest);
    expect(decisions).toEqual([
      { proposalId: "connect:n101>n1", action: "accept" },
      { proposalId: "connect:n102>n1", action: "reject" },
    ]);
    setMergePlanDecisions(planned, decisions);
    expect(planned.summary.features["needs-decision"]).toBe(0);
    expect(
      pickNearestMergePlanDecisions(plan(sameWay(0.4, 0.6), "recommended"), ["connect:n101>n1"]),
    ).toEqual([]);
  });
});
