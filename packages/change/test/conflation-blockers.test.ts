import { Osm } from "@osmix/core";
import type { OsmTags } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { summarizeConflationCandidates } from "../src/conflation.ts";
import {
  discoverConflationCandidates,
  merge,
  type OsmConflationDecision,
  type OsmConflationOptions,
} from "../src/index.ts";
import { findProposal, planAndApply, withMatchingDecisions } from "./helpers/plan.ts";

type RelationKind = "none" | "route" | "restriction";
type ConflictKind = "grade" | "access" | "protected" | "geometry" | "none";

function createWayDataset(
  id: string,
  firstNodeId: number,
  wayId: number,
  lat: number,
  tags: OsmTags,
  relation: RelationKind,
  closed: boolean,
  alternative = false,
) {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: firstNodeId, lon: 0, lat });
  osm.nodes.addNode({ id: firstNodeId + 1, lon: 0.001, lat });
  osm.nodes.addNode({ id: firstNodeId + 2, lon: 0.001, lat: lat + 0.001 });
  osm.ways.addWay({
    id: wayId,
    refs: closed
      ? [firstNodeId, firstNodeId + 1, firstNodeId + 2, firstNodeId]
      : [firstNodeId, firstNodeId + 1],
    tags,
  });
  if (relation === "restriction") {
    osm.ways.addWay({
      id: wayId + 1,
      refs: [firstNodeId + 1, firstNodeId + 2],
      tags: Object.fromEntries(Object.entries(tags).filter(([key]) => key !== "name")),
    });
  }
  if (relation !== "none") {
    osm.relations.addRelation({
      id: wayId * 10,
      tags:
        relation === "route"
          ? { type: "route", route: "foot" }
          : { type: "restriction", restriction: "only_left_turn" },
      members:
        relation === "route"
          ? [{ type: "way", ref: wayId, role: "" }]
          : [
              { type: "way", ref: wayId, role: "from" },
              { type: "node", ref: firstNodeId + 1, role: "via" },
              { type: "way", ref: wayId + 1, role: "to" },
            ],
    });
  }
  if (alternative) {
    osm.nodes.addNode({ id: 11, lon: 0, lat: 0.000008 });
    osm.nodes.addNode({ id: 12, lon: 0.001, lat: 0.000008 });
    osm.ways.addWay({ id: 30, refs: [11, 12], tags });
  }
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function createWayFixture(
  conflict: ConflictKind,
  relationSide: "source" | "target",
  relationKind: Exclude<RelationKind, "none"> = "route",
  ambiguity: "none" | "targets" | "sources" = "none",
) {
  const sourceTags: OsmTags = { highway: "footway", name: "Imported" };
  if (conflict === "grade") Object.assign(sourceTags, { bridge: "yes", layer: "1" });
  if (conflict === "access") sourceTags["access"] = "private";
  if (conflict === "protected") sourceTags["layer"] = "0";
  if (conflict === "geometry") sourceTags["area"] = "yes";
  const base = createWayDataset(
    "base",
    1,
    10,
    0,
    { highway: "footway", name: "Base" },
    relationSide === "target" ? relationKind : "none",
    conflict === "geometry",
    ambiguity === "targets",
  );
  const patch = createWayDataset(
    "patch",
    101,
    20,
    0.000004,
    sourceTags,
    relationSide === "source" ? relationKind : "none",
    conflict === "geometry",
    ambiguity === "sources",
  );
  const options: OsmConflationOptions = {
    propertyKeys: conflict === "protected" ? ["layer"] : ["name"],
    attachNetwork: false,
  };
  return { base, patch, options };
}

function entities(osm: Osm) {
  return {
    nodes: [...osm.nodes.sorted()],
    ways: [...osm.ways.sorted()],
    relations: [...osm.relations.sorted()],
  };
}

const acceptWay: OsmConflationDecision = {
  candidateId: "way:20->10",
  action: "accept",
  transferProperties: true,
  attachNetwork: false,
};

describe("hard conflation blockers survive combined review reasons", () => {
  it.each([
    ["grade", "source", "route", "grade-conflict"],
    ["access", "target", "route", "routing-family-conflict"],
    ["protected", "source", "route", "protected-tag"],
    ["geometry", "target", "route", "geometry-mismatch"],
    ["grade", "source", "restriction", "grade-conflict"],
    ["access", "target", "restriction", "routing-family-conflict"],
  ] as const)("keeps %s blocked with %s %s membership", async (conflict, side, kind, reason) => {
    const { base, patch, options } = createWayFixture(conflict, side, kind);
    const discovery = discoverConflationCandidates(base, patch, options);
    expect(discovery.candidates).toHaveLength(1);
    expect(discovery.candidates[0]).toMatchObject({
      id: acceptWay.candidateId,
      status: "blocked",
      reasons: expect.arrayContaining([reason, "relation-member"]),
      propertyTransfer: {
        status: "blocked",
        reasons: expect.arrayContaining([reason, "relation-member"]),
      },
    });
    const baseline = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false },
      () => {},
    );
    // Accepting the blocked copy leaves it blocked.
    const { plan, osm: result } = planAndApply(base, patch, {
      mergeIdenticalPoints: false,
      createIntersections: false,
      matching: options,
      decisions: [{ proposalId: "copy:w20>w10", action: "accept" }],
    });
    expect(findProposal(plan, "copy:w20>w10")).toMatchObject({
      status: "blocked",
      effect: "blocked",
    });
    expect(entities(result)).toEqual(entities(baseline));
  });

  it("makes explicit acceptance ineffective in the plan and the merge", async () => {
    const { base, patch, options } = createWayFixture("grade", "source");
    const baseline = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false },
      () => {},
    );
    const planned = planAndApply(
      base,
      patch,
      withMatchingDecisions(
        base,
        patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: options },
        [acceptWay],
      ),
    );
    expect(findProposal(planned.plan, "copy:w20>w10").effect).toBe("blocked");
    expect(entities(planned.osm)).toEqual(entities(baseline));
    const result = await merge(
      base,
      patch,
      withMatchingDecisions(
        base,
        patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: options },
        [acceptWay],
      ),
      () => {},
    );
    expect(entities(result)).toEqual(entities(baseline));
  });

  it("keeps blocked acceptance consistent in the summary and the plan", () => {
    const { base, patch, options } = createWayFixture("grade", "source", "restriction");
    const { candidates } = discoverConflationCandidates(base, patch, options);
    expect(summarizeConflationCandidates(candidates, [acceptWay])).toMatchObject({
      accepted: 0,
      blocked: 1,
    });
    const { plan } = planAndApply(
      base,
      patch,
      withMatchingDecisions(
        base,
        patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: options },
        [acceptWay],
      ),
    );
    expect(findProposal(plan, "copy:w20>w10").effect).toBe("blocked");
    expect(plan.summary.features["needs-decision"]).toBe(0);
  });

  it("adds ambiguity evidence without relaxing blocked transfers", () => {
    const { base, patch, options } = createWayFixture("grade", "source", "route", "targets");
    const { candidates } = discoverConflationCandidates(base, patch, options);
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(candidate.propertyTransfer).toMatchObject({
        status: "blocked",
        reasons: expect.arrayContaining(["grade-conflict", "relation-member", "multiple-targets"]),
      });
    }
  });

  it("preserves many-to-one evidence on each blocked action assessment", () => {
    const { base, patch, options } = createWayFixture("grade", "source", "route", "sources");
    const { candidates } = discoverConflationCandidates(base, patch, options);
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(candidate).toMatchObject({
        targetId: 10,
        status: "blocked",
        reasons: expect.arrayContaining(["grade-conflict", "many-to-one"]),
        propertyTransfer: {
          status: "blocked",
          reasons: expect.arrayContaining(["grade-conflict", "many-to-one"]),
        },
      });
    }
  });

  it("allows a compatible ordinary relation member to be reviewed and copied", async () => {
    const { base, patch, options } = createWayFixture("none", "source");
    const { candidates } = discoverConflationCandidates(base, patch, options);
    expect(candidates[0]?.propertyTransfer).toEqual({
      status: "review",
      reasons: ["relation-member"],
    });
    const result = await merge(
      base,
      patch,
      withMatchingDecisions(
        base,
        patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: options },
        [acceptWay],
      ),
      () => {},
    );
    expect(result.ways.getById(10)?.tags?.["name"]).toBe("Imported");
    expect(result.ways.getById(20)).toEqual(patch.ways.getById(20));
    expect([...result.relations]).toEqual([...patch.relations]);
  });

  it("keeps safe property copying usable when relation and copy-of-path context block attachment", async () => {
    const base = new Osm({ id: "base" });
    base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { name: "Base" } });
    base.nodes.addNode({ id: 2, lon: -0.001, lat: 0 });
    base.nodes.addNode({ id: 3, lon: 0.001, lat: 0 });
    base.ways.addWay({ id: 10, refs: [2, 1, 3], tags: { highway: "footway" } });
    base.buildIndexes();
    base.buildSpatialIndexes();
    // Imported way 20 runs 0.4 m beside base way 10: a copy of it, so its point is no junction.
    const patch = new Osm({ id: "patch" });
    patch.nodes.addNode({ id: 101, lon: 0.000005, lat: 0, tags: { name: "Imported" } });
    patch.nodes.addNode({ id: 102, lon: 0.001, lat: 0.000004 });
    patch.nodes.addNode({ id: 103, lon: -0.001, lat: 0.000004 });
    patch.ways.addWay({ id: 20, refs: [103, 101, 102], tags: { highway: "footway" } });
    patch.relations.addRelation({
      id: 200,
      tags: { type: "route", route: "foot" },
      members: [{ type: "way", ref: 20, role: "" }],
    });
    patch.buildIndexes();
    patch.buildSpatialIndexes();
    const options = { propertyKeys: ["name"], attachNetwork: true };
    const discovery = discoverConflationCandidates(base, patch, options);
    const candidate = discovery.candidates.find((item) => item.id === "node:101->1");
    expect(candidate).toMatchObject({
      status: "automatic",
      propertyTransfer: { status: "automatic" },
      networkAttachment: {
        status: "blocked",
        reasons: expect.arrayContaining(["traces-base-way", "relation-member"]),
      },
    });
    const blockedAttachment: OsmConflationDecision = {
      candidateId: "node:101->1",
      action: "accept",
      transferProperties: false,
      attachNetwork: true,
    };
    expect(summarizeConflationCandidates(discovery.candidates, [blockedAttachment])).toMatchObject({
      accepted: 0,
      blocked: 1,
    });
    const baseline = await merge(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false },
      () => {},
    );
    const blockedResult = await merge(
      base,
      patch,
      withMatchingDecisions(
        base,
        patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: options },
        [blockedAttachment],
      ),
      () => {},
    );
    expect(entities(blockedResult)).toEqual(entities(baseline));
    const copyOnly: OsmConflationDecision = {
      candidateId: "node:101->1",
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    };
    const result = await merge(
      base,
      patch,
      withMatchingDecisions(
        base,
        patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: options },
        [copyOnly],
      ),
      () => {},
    );
    expect(result.nodes.getById(1)?.tags).toEqual({ name: "Imported" });
    expect(result.nodes.getById(101)).toEqual(patch.nodes.getById(101));
    expect(result.ways.getById(20)?.refs).toEqual([103, 101, 102]);
    expect([...result.relations]).toEqual([...patch.relations]);
  });
});
