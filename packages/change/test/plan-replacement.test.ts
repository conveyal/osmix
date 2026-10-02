import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { MergePlanDecisionConflictError } from "../src/plan/decision-conflict.ts";
import { planMerge, setMergePlanDecisions } from "../src/plan/plan.ts";
import type { MergePlanAutomation, MergePlanOptions } from "../src/plan/types.ts";
import { findProposal, planAndApply } from "./helpers/plan.ts";

/** Degrees per meter at the equator. */
const M = 1 / 111_320;
const footway = { highway: "footway" };

function osm(id: string, nodes: OsmNode[], ways: OsmWay[], relations: OsmRelation[] = []) {
  const result = new Osm({ id });
  for (const node of nodes) result.nodes.addNode(node);
  for (const way of ways) result.ways.addWay(way);
  for (const relation of relations) result.relations.addRelation(relation);
  result.buildIndexes();
  result.buildSpatialIndexes();
  return result;
}

/**
 * A base footway 111 m east along the equator with an untagged middle node, and a base path
 * meeting its east end.
 */
function base(relations: OsmRelation[] = []) {
  return osm(
    "base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0.0005, lat: 0 },
      { id: 3, lon: 0.001, lat: 0 },
      { id: 4, lon: 0.001, lat: -0.001 },
    ],
    [
      { id: 10, refs: [1, 2, 3], tags: { ...footway, name: "Main Street" } },
      { id: 11, refs: [3, 4], tags: footway },
    ],
    relations,
  );
}

/** An imported sidewalk 0.5 m north of the base footway, as one way or split in two. */
function patch({ split = false, tags = {} }: { split?: boolean; tags?: object } = {}) {
  const nodes = [0, 0.00025, 0.0005, 0.00075, 0.001].map((lon, index) => ({
    id: 101 + index,
    lon,
    lat: 0.5 * M,
  }));
  const sidewalk = { ...footway, footway: "sidewalk", ...tags };
  const ways = split
    ? [
        { id: 20, refs: [101, 102, 103], tags: { ...sidewalk, surface: "asphalt" } },
        { id: 30, refs: [103, 104, 105], tags: { ...sidewalk, surface: "concrete" } },
      ]
    : [{ id: 20, refs: [101, 102, 103, 104, 105], tags: sidewalk }];
  return osm("patch", nodes, ways);
}

function options(automation: MergePlanAutomation = "recommended", allow = true): MergePlanOptions {
  return {
    automation,
    matching: {
      propertyKeys: [],
      attachNetwork: true,
      maxDistanceMeters: 1,
      ...(allow ? { allowWayReplacement: true } : {}),
    },
  };
}

const replacements = (plan: ReturnType<typeof planMerge>) =>
  [...plan.proposals.values()].filter(({ kind }) => kind === "replace-way");

describe("way replacement in a plan (MP-R2)", () => {
  it("proposes nothing unless replacement is allowed", () => {
    expect(replacements(planMerge(base(), patch(), options("aggressive", false)))).toEqual([]);
  });

  it("waits for a person, and excludes connecting the imported way to the base way", () => {
    const plan = planMerge(base(), patch(), options());
    const replace = findProposal(plan, "replace:w20>w10");
    expect(replace).toMatchObject({
      kind: "replace-way",
      status: "review",
      effect: "needs-decision",
      replaces: [{ type: "way", id: 10 }],
    });
    expect(replace.excludes).toEqual(
      expect.arrayContaining(["connect:n101>n1", "connect:n105>n3"]),
    );
    expect(findProposal(plan, "connect:n101>n1").excludes).toContain("replace:w20>w10");
  });

  it("keeps the imported way in place of the base way once included", () => {
    const { plan, osm: merged } = planAndApply(base(), patch(), {
      ...options(),
      decisions: [{ proposalId: "replace:w20>w10", action: "accept" }],
    });
    expect(findProposal(plan, "replace:w20>w10").effect).toBe("applied");
    expect(findProposal(plan, "connect:n101>n1")).toMatchObject({
      decision: "reject",
      effect: "skipped",
    });
    expect(merged.ways.getById(10)).toBeNull();
    expect(merged.nodes.getById(2)).toBeNull();
    // The base way's ends stand in for the imported ends, so the base path still meets it.
    expect(merged.ways.getById(20)).toMatchObject({
      refs: [1, 102, 103, 104, 3],
      tags: { highway: "footway", footway: "sidewalk", name: "Main Street" },
    });
    expect(merged.ways.getById(11)?.refs).toEqual([3, 4]);
    expect(merged.nodes.getById(101)).toBeNull();
    expect(merged.nodes.getById(3)).toMatchObject({ lon: 0.001, lat: 0 });
  });

  it("keeps imported ways whose tags differ separate, decided as one set", () => {
    const plan = planMerge(base(), patch({ split: true }), options());
    const first = findProposal(plan, "replace:w20>w10");
    expect(first).toMatchObject({ set: ["replace:w30>w10"], status: "review" });
    setMergePlanDecisions(plan, [{ proposalId: "replace:w30>w10", action: "accept" }]);
    expect(findProposal(plan, "replace:w20>w10").effect).toBe("applied");

    const { osm: merged } = planAndApply(base(), patch({ split: true }), {
      ...options(),
      decisions: [{ proposalId: "replace:w20>w10", action: "accept" }],
    });
    expect(merged.ways.getById(20)).toMatchObject({ refs: [1, 102, 103] });
    expect(merged.ways.getById(20)?.tags?.["surface"]).toBe("asphalt");
    expect(merged.ways.getById(30)).toMatchObject({ refs: [103, 104, 3] });
    expect(merged.ways.getById(30)?.tags?.["surface"]).toBe("concrete");

    expect(() =>
      planMerge(base(), patch({ split: true }), {
        ...options(),
        decisions: [
          { proposalId: "replace:w20>w10", action: "accept" },
          { proposalId: "replace:w30>w10", action: "reject" },
        ],
      }),
    ).toThrow(MergePlanDecisionConflictError);
  });

  it("moves the base way's relation memberships to the imported ways", () => {
    const route = { id: 50, tags: { type: "route", route: "foot" } };
    const members = [
      { type: "way" as const, ref: 11, role: "" },
      { type: "way" as const, ref: 10, role: "" },
    ];
    const { osm: merged } = planAndApply(base([{ ...route, members }]), patch({ split: true }), {
      ...options(),
      decisions: [{ proposalId: "replace:w20>w10", action: "accept" }],
    });
    expect(merged.relations.getById(50)?.members).toEqual([
      { type: "way", ref: 11, role: "" },
      { type: "way", ref: 20, role: "" },
      { type: "way", ref: 30, role: "" },
    ]);
  });

  it("is included by the aggressive level only, never across a change of grade", () => {
    expect(findProposal(planMerge(base(), patch(), options()), "replace:w20>w10").decision).toBe(
      undefined,
    );
    const aggressive = planMerge(base(), patch(), options("aggressive"));
    expect(findProposal(aggressive, "replace:w20>w10")).toMatchObject({
      decision: "accept",
      automated: true,
      effect: "applied",
    });
    expect(findProposal(aggressive, "connect:n101>n1")).toMatchObject({
      decision: "reject",
      automated: true,
    });
    const bridge = planMerge(
      base(),
      patch({ tags: { bridge: "yes", layer: "1" } }),
      options("aggressive"),
    );
    expect(findProposal(bridge, "replace:w20>w10")).toMatchObject({
      reasons: ["grade-change"],
      effect: "needs-decision",
    });
  });

  it("rejects including a replacement and a connection it excludes", () => {
    expect(() =>
      planMerge(base(), patch(), {
        ...options(),
        decisions: [
          { proposalId: "replace:w20>w10", action: "accept" },
          { proposalId: "connect:n101>n1", action: "accept" },
        ],
      }),
    ).toThrow(MergePlanDecisionConflictError);
  });
});
