import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { discoverConflationCandidates, resolveConflationActions } from "../src/conflation.ts";
import { merge } from "../src/merge.ts";
import { applyPlan, planMerge } from "../src/plan/plan.ts";
import type { MergePlanOptions, PlanDecision } from "../src/plan/types.ts";
import type { OsmConflationDecision } from "../src/types.ts";
import { findProposal, planAndApply, withMatchingDecisions } from "./helpers/plan.ts";

function createFixture(blockSecondTarget = false) {
  const base = new Osm({ id: "base" });
  for (const node of [
    { id: 1, lon: -0.000003, lat: 0, tags: { name: "A" } },
    { id: 2, lon: 0.000003, lat: 0, tags: { name: "B" } },
    { id: 3, lon: 0.01, lat: 0, tags: { name: "Other" } },
    { id: 11, lon: -0.001, lat: 0 },
    { id: 12, lon: -0.001, lat: 0.000002 },
    { id: 13, lon: 0.009, lat: 0 },
  ])
    base.nodes.addNode(node);
  base.ways.addWay({ id: 10, refs: [11, 1], tags: { highway: "footway" } });
  base.ways.addWay({
    id: 11,
    refs: [12, 2],
    tags: { highway: "footway", ...(blockSecondTarget ? { bridge: "yes", layer: "1" } : {}) },
  });
  base.ways.addWay({ id: 12, refs: [13, 3], tags: { highway: "footway" } });
  base.buildIndexes();
  base.buildSpatialIndexes();
  const patch = new Osm({ id: "patch" });
  for (const node of [
    { id: 101, lon: 0, lat: 0, tags: { name: "Imported" } },
    { id: 102, lon: 0.001, lat: 0 },
    { id: 201, lon: 0.010005, lat: 0, tags: { name: "Unrelated" } },
    { id: 202, lon: 0.011, lat: 0 },
  ])
    patch.nodes.addNode(node);
  patch.ways.addWay({ id: 20, refs: [101, 102], tags: { highway: "footway" } });
  patch.ways.addWay({ id: 21, refs: [201, 202], tags: { highway: "footway" } });
  patch.buildIndexes();
  patch.buildSpatialIndexes();
  const options = { propertyKeys: ["name"], attachNetwork: true };
  const discovery = discoverConflationCandidates(base, patch, options);
  const first = discovery.candidates.find((candidate) => candidate.id === "node:101->1");
  const second = discovery.candidates.find((candidate) => candidate.id === "node:101->2");
  const unrelated = discovery.candidates.find((candidate) => candidate.id === "node:201->3");
  if (!first || !second || !unrelated) throw Error("Expected alternative and unrelated matches");
  return { base, patch, options, discovery, first, second, unrelated };
}

function conflicts(): OsmConflationDecision[] {
  return [
    {
      candidateId: "node:101->1",
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    },
    {
      candidateId: "node:101->2",
      action: "accept",
      transferProperties: false,
      attachNetwork: true,
    },
  ];
}

const quiet = () => {};

function matchingOptions(
  matching: MergePlanOptions["matching"],
  decisions: readonly PlanDecision[] = [],
): MergePlanOptions {
  return { mergeIdenticalPoints: false, createIntersections: false, matching, decisions };
}

describe("one selected target per imported feature", () => {
  it("rejects a copy/connection split across targets when planning", () => {
    const { base, patch, options, first, second } = createFixture();
    expect(first.propertyTransfer.status).toBe("review");
    expect(second.networkAttachment?.status).toBe("review");
    const plan = planMerge(base, patch, matchingOptions(options), quiet);
    expect(findProposal(plan, "copy:n101>n1")).toMatchObject({ alternatives: ["copy:n101>n2"] });
    expect(findProposal(plan, "connect:n101>n2")).toMatchObject({
      alternatives: ["connect:n101>n1"],
    });
    const decisions: PlanDecision[] = [
      { proposalId: "copy:n101>n1", action: "accept" },
      { proposalId: "connect:n101>n2", action: "accept" },
    ];
    const before = structuredClone(decisions);
    let error: unknown;
    try {
      planMerge(base, patch, matchingOptions(options, decisions), quiet);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/imported node 101.*node:101->1.*node:101->2/);
    expect(error).toMatchObject({
      conflict: {
        entityType: "node",
        sourceId: 101,
        candidateIds: [first.id, second.id],
        message: expect.stringContaining("Choose one target or skip"),
      },
    });
    expect(decisions).toEqual(before);
  });

  it("rejects accepting every action of two alternatives", () => {
    const { base, patch, options } = createFixture();
    expect(() =>
      planMerge(
        base,
        patch,
        withMatchingDecisions(base, patch, matchingOptions(options), [
          { candidateId: "node:101->1", action: "accept" },
          { candidateId: "node:101->2", action: "accept" },
        ]),
        quiet,
      ),
    ).toThrow(/imported node 101/);
  });

  it("switches the selected target while preserving unrelated choices", async () => {
    const { base, patch, options, first, second, unrelated } = createFixture();
    const otherDecision: OsmConflationDecision = {
      candidateId: unrelated.id,
      action: "accept",
      transferProperties: false,
      attachNetwork: true,
    };
    const current = [...conflicts(), otherDecision];
    expect(() =>
      planMerge(base, patch, withMatchingDecisions(base, patch, matchingOptions(options), current)),
    ).toThrow(/imported node 101/);
    const selected: OsmConflationDecision = {
      candidateId: second.id,
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    };
    const decisions: OsmConflationDecision[] = [
      { candidateId: first.id, action: "reject" },
      selected,
      otherDecision,
    ];
    const planOptions = withMatchingDecisions(base, patch, matchingOptions(options), decisions);
    const plan = planMerge(base, patch, planOptions, quiet);
    expect(findProposal(plan, "copy:n101>n2").effect).toBe("applied");
    expect(findProposal(plan, "copy:n101>n1").effect).toBe("skipped");
    expect(findProposal(plan, "connect:n201>n3").effect).toBe("applied");
    const result = await merge(base, patch, planOptions, quiet);
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("A");
    expect(result.nodes.getById(2)?.tags?.["name"]).toBe("Imported");
    expect(result.nodes.getById(3)?.tags?.["name"]).toBe("Other");
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
    expect(result.ways.getById(21)?.refs).toEqual([3, 202]);
    expect(base.nodes.getById(2)?.tags?.["name"]).toBe("B");
    expect(patch.ways.getById(21)?.refs).toEqual([201, 202]);
  });

  it("leaves a source unmatched by rejecting every alternative without changing other sources", () => {
    const { base, patch, options, first, second, unrelated } = createFixture();
    const decisions: OsmConflationDecision[] = [
      { candidateId: first.id, action: "reject" },
      { candidateId: second.id, action: "reject" },
      { candidateId: unrelated.id, action: "reject" },
    ];
    for (const candidate of [first, second]) {
      expect(
        resolveConflationActions(
          candidate,
          decisions.find((item) => item.candidateId === candidate.id),
        ),
      ).toEqual({
        transferProperties: false,
        attachNetwork: false,
      });
    }
    const { plan, osm: result } = planAndApply(
      base,
      patch,
      withMatchingDecisions(base, patch, matchingOptions(options), decisions),
    );
    for (const proposal of plan.proposals.values()) {
      if ("candidateId" in proposal) expect(proposal.effect, proposal.id).toBe("skipped");
    }
    expect(plan.summary.features["needs-decision"]).toBe(0);
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("A");
    expect(result.nodes.getById(2)?.tags?.["name"]).toBe("B");
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
    expect(result.ways.getById(21)?.refs).toEqual([201, 202]);
  });

  it("does not count hard-blocked requested actions as another selected target", async () => {
    const { base, patch, options, first, second } = createFixture(true);
    expect(second.propertyTransfer.status).toBe("blocked");
    expect(second.networkAttachment?.status).toBe("blocked");
    const decisions: OsmConflationDecision[] = [
      { candidateId: first.id, action: "accept", transferProperties: true, attachNetwork: false },
      { candidateId: second.id, action: "accept" },
    ];
    const plan = planMerge(
      base,
      patch,
      withMatchingDecisions(base, patch, matchingOptions(options), decisions),
      quiet,
    );
    expect(findProposal(plan, "copy:n101>n1").effect).toBe("applied");
    expect(findProposal(plan, "copy:n101>n2").effect).toBe("blocked");
    expect(resolveConflationActions(second, decisions[1])).toEqual({
      transferProperties: false,
      attachNetwork: false,
    });
    const blockedSelection: OsmConflationDecision[] = [
      { candidateId: first.id, action: "reject" },
      decisions[1]!,
    ];
    const result = await merge(
      base,
      patch,
      withMatchingDecisions(base, patch, matchingOptions(options), blockedSelection),
      quiet,
    );
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("A");
    expect(result.nodes.getById(2)?.tags?.["name"]).toBe("B");
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
  });

  it("reports decisions naming no proposal as stale", () => {
    const { base, patch, options } = createFixture();
    const plan = planMerge(
      base,
      patch,
      matchingOptions(options, [{ proposalId: "copy:n101>n99", action: "accept" }]),
      quiet,
    );
    expect(plan.staleDecisions).toEqual(["copy:n101>n99"]);
    expect(() =>
      withMatchingDecisions(base, patch, matchingOptions(options), [
        { candidateId: "node:101->99", action: "accept" },
      ]),
    ).toThrow("Unknown conflation candidate");
  });

  it("connects two imported ways to one base node, but not two points of one way", () => {
    const base = new Osm({ id: "base" });
    base.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    base.nodes.addNode({ id: 2, lon: -0.001, lat: 0 });
    base.ways.addWay({ id: 10, refs: [2, 1], tags: { highway: "footway" } });
    base.buildIndexes();
    base.buildSpatialIndexes();
    const twoWays = new Osm({ id: "patch" });
    twoWays.nodes.addNode({ id: 101, lon: 0.000003, lat: 0 });
    twoWays.nodes.addNode({ id: 102, lon: 0.001, lat: 0 });
    twoWays.nodes.addNode({ id: 301, lon: 0, lat: 0.000003 });
    twoWays.nodes.addNode({ id: 302, lon: 0, lat: 0.001 });
    twoWays.ways.addWay({ id: 20, refs: [101, 102], tags: { highway: "footway" } });
    twoWays.ways.addWay({ id: 30, refs: [301, 302], tags: { highway: "footway" } });
    twoWays.buildIndexes();
    twoWays.buildSpatialIndexes();
    const options = { propertyKeys: [], attachNetwork: true };
    // An import gap: both ways end next to base node 1, and both connect there (MP-M5).
    const shared = planMerge(base, twoWays, matchingOptions(options), quiet);
    for (const id of ["connect:n101>n1", "connect:n301>n1"]) {
      expect(shared.proposals.get(id)).toMatchObject({
        status: "automatic",
        competitors: [],
        effect: "applied",
      });
    }
    const merged = applyPlan(shared).osm;
    expect(merged.ways.getById(20)?.refs[0]).toBe(1);
    expect(merged.ways.getById(30)?.refs[0]).toBe(1);

    // Two points of one way would loop it through node 1: one connection only.
    const oneWay = new Osm({ id: "patch" });
    oneWay.nodes.addNode({ id: 103, lon: 0, lat: 0.000003 });
    oneWay.nodes.addNode({ id: 101, lon: 0.000003, lat: 0 });
    oneWay.nodes.addNode({ id: 102, lon: 0.001, lat: 0 });
    oneWay.ways.addWay({ id: 20, refs: [103, 101, 102], tags: { highway: "footway" } });
    oneWay.buildIndexes();
    oneWay.buildSpatialIndexes();
    const decisions: PlanDecision[] = [
      { proposalId: "connect:n101>n1", action: "accept" },
      { proposalId: "connect:n103>n1", action: "accept" },
    ];
    expect(() => planMerge(base, oneWay, matchingOptions(options, decisions), quiet)).toThrow(
      "would both connect to base node 1, but they are points of one imported way, which " +
        "connecting both would fold onto one point. Include at most one",
    );
  });

  it("still rejects transferring two imported ways to the same base way", () => {
    const base = new Osm({ id: "base" });
    base.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    base.nodes.addNode({ id: 2, lon: 0.001, lat: 0 });
    base.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "footway", name: "Base" } });
    base.buildIndexes();
    base.buildSpatialIndexes();
    const patch = new Osm({ id: "patch" });
    patch.nodes.addNode({ id: 101, lon: 0, lat: 0.000004 });
    patch.nodes.addNode({ id: 102, lon: 0.001, lat: 0.000004 });
    patch.nodes.addNode({ id: 111, lon: 0, lat: -0.000004 });
    patch.nodes.addNode({ id: 112, lon: 0.001, lat: -0.000004 });
    patch.ways.addWay({ id: 20, refs: [101, 102], tags: { highway: "footway", name: "A" } });
    patch.ways.addWay({ id: 21, refs: [111, 112], tags: { highway: "footway", name: "B" } });
    patch.buildIndexes();
    patch.buildSpatialIndexes();
    const options = { propertyKeys: ["name"], attachNetwork: false };
    const decisions: PlanDecision[] = [
      { proposalId: "copy:w20>w10", action: "accept" },
      { proposalId: "copy:w21>w10", action: "accept" },
    ];
    expect(() => planMerge(base, patch, matchingOptions(options, decisions), quiet)).toThrow(
      "Imported way 20 and imported way 21 would both change base way 10",
    );
  });
});
