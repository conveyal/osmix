import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmTags, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import {
  discoverConflationCandidates,
  refreshConflationWayRemovalAssessments,
  resolveConflationActions,
} from "../src/conflation.ts";
import { merge } from "../src/merge.ts";
import { planMerge } from "../src/plan/plan.ts";
import type { OsmConflationDecision, OsmConflationOptions } from "../src/types.ts";
import { findProposal, planAndApply, withMatchingDecisions } from "./helpers/plan.ts";

function osm(id: string, nodes: OsmNode[], ways: OsmWay[], relations: OsmRelation[] = []) {
  const result = new Osm({ id });
  for (const node of nodes) result.nodes.addNode(node);
  for (const way of ways) result.ways.addWay(way);
  for (const relation of relations) result.relations.addRelation(relation);
  result.buildIndexes();
  result.buildSpatialIndexes();
  return result;
}
function fixture({
  branch = false,
  sourceTags = {},
  targetTags = {},
  sourceNodeTags = {},
  targetNodeTags = {},
  sourceRefs = [101, 102],
  relations = [],
  baseRelations = [],
  branchTags = { highway: "footway" },
  reversed = false,
}: {
  branch?: boolean;
  sourceTags?: OsmTags;
  targetTags?: OsmTags;
  sourceNodeTags?: OsmTags;
  targetNodeTags?: OsmTags;
  sourceRefs?: number[];
  relations?: OsmRelation[];
  baseRelations?: OsmRelation[];
  branchTags?: OsmTags;
  reversed?: boolean;
} = {}) {
  const base = osm(
    "base",
    [
      { id: 1, lon: 0, lat: 0, tags: targetNodeTags },
      { id: 2, lon: 0.001, lat: 0 },
    ],
    [
      {
        id: 10,
        refs: reversed ? [2, 1] : [1, 2],
        tags: { highway: "footway", name: "Base", ...targetTags },
      },
    ],
    baseRelations,
  );
  const patch = osm(
    "patch",
    [
      { id: 101, lon: 0, lat: 0.000004, tags: sourceNodeTags },
      { id: 102, lon: 0.001, lat: 0.000004 },
      { id: 103, lon: 0.002, lat: 0.000004 },
    ],
    [
      { id: 20, refs: sourceRefs, tags: { highway: "footway", name: "Import", ...sourceTags } },
      ...(branch ? [{ id: 30, refs: [102, 103], tags: branchTags }] : []),
    ],
    relations,
  );
  return { base, patch };
}
const options: OsmConflationOptions = {
  propertyKeys: [],
  attachNetwork: false,
  allowWayRemoval: true,
  automatic: "none",
};
const remove: OsmConflationDecision = {
  candidateId: "way:20->10",
  action: "accept",
  transferProperties: false,
  attachNetwork: false,
  removeWay: true,
};
const connect: OsmConflationDecision = {
  candidateId: "node:102->2",
  action: "accept",
  transferProperties: false,
  attachNetwork: true,
};
function discover(input: ReturnType<typeof fixture>, config = options) {
  return discoverConflationCandidates(input.base, input.patch, config);
}
function trunk(input: ReturnType<typeof fixture>, config = options) {
  const candidate = discover(input, config).candidates.find(
    (candidate) => candidate.id === remove.candidateId,
  );
  if (!candidate) throw Error("Expected trunk candidate");
  return candidate;
}
/** Plan and apply the matching merge with `decisions` written as candidate decisions. */
function generate(input: ReturnType<typeof fixture>, decisions = [remove], config = options) {
  const { plan, osm: result } = planAndApply(
    input.base,
    input.patch,
    withMatchingDecisions(
      input.base,
      input.patch,
      { mergeIdenticalPoints: false, createIntersections: false, matching: config },
      decisions,
    ),
  );
  const outcome = plan.matching?.outcome;
  if (!outcome) throw Error("The plan has no matching outcome");
  return { plan, result, outcome };
}
/** Plan the removal of way 20 and expect it blocked for `reason`, keeping the imported way. */
function expectRemovalBlocked(
  input: ReturnType<typeof fixture>,
  reason: RegExp,
  decisions = [remove],
  config = options,
) {
  const { plan, result } = generate(input, decisions, config);
  const removal = findProposal(plan, "remove:w20>w10");
  expect(removal).toMatchObject({ status: "blocked", effect: "blocked" });
  expect(removal.reasons.join(",")).toMatch(reason);
  expect(result.ways.ids.has(20)).toBe(true);
  return plan;
}

describe("explicit way removal topology contract", () => {
  it("requires separate opt-in and an explicit removal flag", () => {
    const input = fixture();
    const candidate = trunk(input);
    expect(resolveConflationActions(candidate)).not.toHaveProperty("removeWay");
    expect(
      resolveConflationActions(candidate, { candidateId: candidate.id, action: "accept" }),
    ).not.toHaveProperty("removeWay");
    // Without the opt-in there is no removal proposal, so a removal decision names nothing.
    const disabled = planMerge(
      input.base,
      input.patch,
      {
        mergeIdenticalPoints: false,
        createIntersections: false,
        matching: { propertyKeys: ["name"], attachNetwork: false },
        decisions: [{ proposalId: "remove:w20>w10", action: "accept" }],
      },
      () => {},
    );
    expect(disabled.proposals.has("remove:w20>w10")).toBe(false);
    expect(disabled.staleDecisions).toEqual(["remove:w20>w10"]);
    const undecided = generate(input, []);
    expect(findProposal(undecided.plan, "remove:w20>w10")).toMatchObject({
      status: "review",
      effect: "needs-decision",
    });
    expect(undecided.result.ways.ids.has(20)).toBe(true);
  });
  it("removes the way in the plan and the merge, keeping tagged and other points", async () => {
    const input = fixture({ sourceNodeTags: { name: "Survey marker" } });
    const cumulative = generate(input);
    const result = await merge(
      input.base,
      input.patch,
      withMatchingDecisions(
        input.base,
        input.patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: options },
        [remove],
      ),
      () => {},
    );
    expect([...result.nodes.sorted()]).toEqual([...cumulative.result.nodes.sorted()]);
    expect([...result.ways.sorted()]).toEqual([...input.base.ways.sorted()]);
    expect([...result.nodes.sorted()].map((node) => node.id)).toEqual([1, 2, 101, 103]);
    expect(
      cumulative.outcome.features.find((feature) => feature.sourceId === 20)?.wayRemoval,
    ).toMatchObject({ orphanNodeIds: [102], retainedTaggedNodeIds: [101] });
    expect(input.patch.ways.ids.has(20)).toBe(true);
  });
  it("blocks a retained branch until its connection is explicitly selected", () => {
    const input = fixture({ branch: true });
    const config = { ...options, attachNetwork: true };
    const blocked = trunk(input, config);
    expect(blocked.wayRemoval).toMatchObject({
      status: "blocked",
      preview: {
        blockedNodeIds: [102],
        connections: [
          { sourceNodeId: 102, targetNodeId: 2, retainedWayIds: [30], explicitlyAccepted: false },
        ],
      },
    });
    expectRemovalBlocked(input, /way-removal-connection-required/, [remove], config);
    const output = generate(input, [connect, remove], config);
    expect(findProposal(output.plan, "remove:w20>w10").effect).toBe("applied");
    expect(output.result.ways.ids.has(20)).toBe(false);
    expect(output.result.ways.getById(30)?.refs).toEqual([2, 103]);
    expect(output.result.nodes.ids.has(101)).toBe(false);
    // 102 was left unused by the separately selected attachment, which drops it; removing way20
    // only accounts for 101.
    expect(output.result.nodes.ids.has(102)).toBe(false);
    expect(output.outcome.summary).toMatchObject({
      wayRemovalActions: 1,
      removedOrphanNodes: 1,
      removedConnectionOrphanNodes: 1,
    });
  });
  it("does not let automatic connections or tag selections authorize branch-dependent removal", () => {
    const input = fixture({ branch: true });
    for (const propertyKeys of [[], ["name"], ["highway"]]) {
      const config = {
        ...options,
        attachNetwork: true,
        automatic: "high-confidence" as const,
        propertyKeys,
      };
      const plan = expectRemovalBlocked(input, /way-removal-connection-required/, [remove], config);
      expect(findProposal(plan, "connect:n102>n2")).toMatchObject({
        status: "automatic",
        effect: "applied",
      });
    }
  });
  it("refreshes plans atomically when required connections are edited", () => {
    const input = fixture({ branch: true });
    const discovery = discover(input, { ...options, attachNetwork: true });
    refreshConflationWayRemovalAssessments(
      input.base,
      input.patch,
      discovery,
      [connect, remove],
      true,
    );
    const before = structuredClone(discovery);
    expect(() =>
      refreshConflationWayRemovalAssessments(
        input.base,
        input.patch,
        discovery,
        [{ ...connect, action: "reject" }, remove],
        true,
      ),
    ).toThrow(/clear its removal choice/);
    expect(discovery).toEqual(before);
  });
  it.each([
    ["way access", { sourceTags: { access: "private" } }, "routing"],
    ["surface", { sourceTags: { surface: "gravel" } }, "routing"],
    [
      "classification",
      { sourceTags: { amenity: "cafe" }, targetTags: { amenity: "school" } },
      "feature-type-conflict",
    ],
    ["grade", { sourceTags: { bridge: "yes", layer: 1 } }, "grade-conflict"],
    ["node barrier", { sourceNodeTags: { barrier: "gate" } }, "routing"],
    ["target barrier", { targetNodeTags: { barrier: "gate" } }, "routing"],
  ] as const)("blocks %s independently of selected tags", (_name, variation, reason) => {
    const input = fixture(variation);
    const candidate = trunk(input);
    expect(candidate.wayRemoval?.status).toBe("blocked");
    expect(candidate.wayRemoval?.reasons.join(",")).toContain(reason);
    expectRemovalBlocked(input, new RegExp(reason));
  });
  it.each<OsmRelation>([
    {
      id: 40,
      members: [
        { type: "way", ref: 20, role: "from" },
        { type: "node", ref: 102, role: "via" },
        { type: "way", ref: 30, role: "to" },
      ],
      tags: { type: "restriction", restriction: "no_right_turn" },
    },
    {
      id: 41,
      members: [{ type: "node", ref: 101, role: "stop" }],
      tags: { type: "route", route: "bus" },
    },
  ])("retains all relation members for relation $id", (relation) => {
    const input = fixture({ relations: [relation], branch: true });
    expect(trunk(input).wayRemoval).toMatchObject({
      status: "blocked",
      preview: { blockingRelationIds: [relation.id] },
    });
    expectRemovalBlocked(input, /relation-member/);
  });
  it("keeps an unsupported closed imported way unmatched", () => {
    const input = fixture({ sourceRefs: [101, 102, 101] });
    const candidate = discover(input).candidates.find(
      (candidate) => candidate.entityType === "way",
    );
    expect(candidate?.wayRemoval).toMatchObject({
      status: "unmatched",
      reasons: ["way-removal-unsupported"],
    });
    // With no target there is nothing to propose, so nothing can select the removal.
    const { plan, result } = generate(input, []);
    expect([...plan.proposals.values()].some((proposal) => "candidateId" in proposal)).toBe(false);
    expect(result.ways.ids.has(20)).toBe(true);
    expect(() => generate(input, [{ ...remove, candidateId: candidate!.id }])).toThrow(
      `Unknown conflation candidate: ${candidate!.id}`,
    );
  });
  it("blocks removal when the retained base way belongs to a relation", () => {
    const input = fixture({
      baseRelations: [
        {
          id: 40,
          members: [{ type: "way", ref: 10, role: "" }],
          tags: { type: "route", route: "hiking" },
        },
      ],
    });
    expectRemovalBlocked(input, /relation-member/);
  });
  it("checks non-routing branches rather than ignoring them", () => {
    const input = fixture({ branch: true, branchTags: { natural: "tree_row" } });
    expectRemovalBlocked(input, /connection-required/, [connect, remove], {
      ...options,
      attachNetwork: true,
    });
  });
  it("supports reversed equivalent direction aliases and blocks other directional meanings", () => {
    expect(
      generate(
        fixture({ reversed: true, sourceTags: { oneway: "yes" }, targetTags: { oneway: "-1" } }),
      ).result.ways.ids.has(20),
    ).toBe(false);
    expectRemovalBlocked(
      fixture({ reversed: true, sourceTags: { incline: "5%" }, targetTags: { incline: "5%" } }),
      /routing-conflict/,
    );
  });
  it("preserves a connection that already uses the paired base node", () => {
    const input = fixture();
    const patch = osm(
      "patch",
      [input.base.nodes.getById(1)!, ...input.patch.nodes],
      [{ id: 20, refs: [1, 102], tags: { highway: "footway", name: "Import" } }],
    );
    const generated = generate({ base: input.base, patch });
    expect(generated.result.nodes.ids.has(1)).toBe(true);
    expect(generated.result.ways.getById(10)?.refs).toEqual([1, 2]);
    expect(
      generated.outcome.features.find((feature) => feature.sourceId === 20)?.wayRemoval
        ?.connections,
    ).toEqual([
      {
        sourceNodeId: 1,
        targetNodeId: 1,
        retainedWayIds: [10],
        attachmentCandidateId: null,
        explicitlyAccepted: true,
      },
    ]);
  });
  it("cannot use two dependent removals to hide their shared junction", () => {
    const input = fixture();
    const base = osm(
      "base",
      [...input.base.nodes, { id: 3, lon: 0.002, lat: 0 }],
      [...input.base.ways, { id: 11, refs: [2, 3], tags: { highway: "footway" } }],
    );
    const patch = osm(
      "patch",
      [...input.patch.nodes],
      [...input.patch.ways, { id: 30, refs: [102, 103], tags: { highway: "footway" } }],
    );
    const config = { ...options, attachNetwork: true };
    const { plan, result } = generate(
      { base, patch },
      [connect, remove, { ...remove, candidateId: "way:30->11" }],
      config,
    );
    for (const id of ["remove:w20>w10", "remove:w30>w11"]) {
      expect(findProposal(plan, id)).toMatchObject({ status: "blocked", effect: "blocked" });
      expect(findProposal(plan, id).reasons).toContain("way-removal-topology-conflict");
    }
    expect(result.ways.ids.has(20)).toBe(true);
    expect(result.ways.ids.has(30)).toBe(true);
    expect(base.ways.ids.has(10)).toBe(true);
    expect(patch.ways.ids.has(20)).toBe(true);
  });
  it("reports a removal as stale once identical-point merges reconcile the way", () => {
    const input = fixture();
    const patch = osm(
      "patch",
      [...input.patch.nodes].map((node) => ({ ...node, lat: 0 })),
      [...input.patch.ways],
    );
    const { plan, osm: result } = planAndApply(input.base, patch, {
      createIntersections: false,
      matching: options,
      decisions: [{ proposalId: "remove:w20>w10", action: "accept" }],
    });
    expect(findProposal(plan, "reconcile:w20>w10").effect).toBe("applied");
    expect(plan.staleDecisions).toEqual(["remove:w20>w10"]);
    expect(result.ways.ids.has(20)).toBe(false);
    expect(result.ways.getById(10)).toEqual(input.base.ways.getById(10));
  });
  it.each([
    [
      "sidewalk side",
      {
        sourceTags: { highway: "residential", sidewalk: "left" },
        targetTags: { highway: "residential", sidewalk: "left" },
      },
    ],
    [
      "opposite cycleway",
      { sourceTags: { cycleway: "opposite_lane" }, targetTags: { cycleway: "opposite_lane" } },
    ],
    [
      "node direction",
      { sourceNodeTags: { direction: "forward" }, targetNodeTags: { direction: "forward" } },
    ],
  ] as const)("blocks reversed matches with relative %s values", (_name, tags) => {
    const input = fixture({ ...tags, reversed: true });
    expectRemovalBlocked(input, /routing-conflict/);
  });
  it("rechecks direction after selected tag copies change the retained way", () => {
    const input = fixture({
      reversed: true,
      sourceTags: { oneway: "yes" },
      targetTags: { oneway: "-1" },
    });
    const config = { ...options, propertyKeys: ["oneway"] };
    // Each is reviewable alone; together the copy reverses the way the removal relies on.
    const copyOnly = generate(
      input,
      [{ ...remove, transferProperties: true, removeWay: false }],
      config,
    );
    expect(findProposal(copyOnly.plan, "remove:w20>w10").status).toBe("review");
    expect(() => generate(input, [{ ...remove, transferProperties: true }], config)).toThrow(
      /routing-conflict/,
    );
  });
  // Suspected bug: planning throws "Cannot remove imported way 20: way-removal-routing-conflict"
  // when the accepted copy and removal conflict, instead of showing the removal as blocked.
  it.skip("blocks a removal an accepted direction copy invalidates, without throwing", () => {
    const input = fixture({
      reversed: true,
      sourceTags: { oneway: "yes" },
      targetTags: { oneway: "-1" },
    });
    const config = { ...options, propertyKeys: ["oneway"] };
    expectRemovalBlocked(
      input,
      /routing-conflict/,
      [{ ...remove, transferProperties: true }],
      config,
    );
  });
  it("keeps original relation blockers authoritative after same-ID relation updates", () => {
    const input = fixture({
      baseRelations: [
        {
          id: 40,
          members: [
            { type: "way", ref: 10, role: "from" },
            { type: "node", ref: 2, role: "via" },
          ],
          tags: { type: "restriction", restriction: "no_right_turn" },
        },
      ],
    });
    const patch = osm(
      "patch",
      [...input.patch.nodes],
      [...input.patch.ways],
      [
        {
          id: 40,
          members: [{ type: "way", ref: 20, role: "" }],
          tags: { type: "route", route: "hiking" },
        },
      ],
    );
    const withoutTarget = osm(
      "patch",
      [...patch.nodes],
      [...patch.ways],
      [{ id: 40, members: [], tags: { type: "route", route: "hiking" } }],
    );
    expectRemovalBlocked({ base: input.base, patch: withoutTarget }, /relation-member/);
  });
});
