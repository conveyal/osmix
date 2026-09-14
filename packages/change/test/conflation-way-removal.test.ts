import { Osm } from "@osmix/core";
import type { OsmNode, OsmRelation, OsmTags, OsmWay } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { applyChangesetToOsm } from "../src/apply-changeset.ts";
import {
  buildConflationActionDecision,
  buildConflationBulkDecisionResult,
  discoverConflationCandidates,
  generateConflationApplicationChangeset,
  generateConflationArtifacts,
  resolveConflationActions,
} from "../src/conflation.ts";
import { generateChangeset } from "../src/generate-changeset.ts";
import { refreshConflationWayRemovalAssessments } from "../src/internal/conflation.ts";
import { merge } from "../src/merge.ts";
import type { OsmConflationDecision, OsmConflationOptions } from "../src/types.ts";

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
function generate(input: ReturnType<typeof fixture>, decisions = [remove], config = options) {
  return generateConflationArtifacts(
    input.base,
    input.patch,
    { directMerge: true, conflation: config },
    decisions,
  );
}

describe("explicit way removal topology contract", () => {
  it("requires separate opt-in and an explicit removal flag", () => {
    const input = fixture();
    const candidate = trunk(input);
    expect(resolveConflationActions(candidate)).not.toHaveProperty("removeWay");
    expect(
      resolveConflationActions(candidate, { candidateId: candidate.id, action: "accept" }),
    ).not.toHaveProperty("removeWay");
    expect(() =>
      generate(input, [remove], { propertyKeys: ["name"], attachNetwork: false }),
    ).toThrow(/removal is not enabled/);
    expect(generate(input, []).result.ways.ids.has(20)).toBe(true);
  });
  it("preserves the explicit removal choice while independently toggling copy and connection", () => {
    const candidate = trunk(fixture(), { ...options, propertyKeys: ["name"] });
    expect(
      buildConflationActionDecision(candidate, remove, "transfer-properties", true),
    ).toMatchObject({ transferProperties: true, removeWay: true });
    expect(buildConflationActionDecision(candidate, remove, "remove-way", false)).toMatchObject({
      removeWay: false,
      transferProperties: false,
    });
    const bulk = buildConflationBulkDecisionResult([candidate], [], {
      action: "transfer-properties",
      filter: {},
    });
    expect(bulk.decisions.every((decision) => decision.removeWay !== true)).toBe(true);
  });
  it("does not revive ignored removal flags when copying a previously rejected match", () => {
    const candidate = trunk(fixture(), { ...options, propertyKeys: ["name"] });
    const rejected: OsmConflationDecision = { ...remove, action: "reject" };
    expect(
      buildConflationActionDecision(candidate, rejected, "transfer-properties", true),
    ).not.toHaveProperty("removeWay");
    const bulk = buildConflationBulkDecisionResult([candidate], [rejected], {
      action: "transfer-properties",
      filter: {},
    });
    expect(
      bulk.decisions.find((decision) => decision.candidateId === candidate.id),
    ).not.toHaveProperty("removeWay");
  });
  it("matches high-level and cumulative removal while preserving tagged and unrelated points", async () => {
    const input = fixture({ sourceNodeTags: { name: "Survey marker" } });
    const cumulative = generate(input);
    const result = await merge(
      input.base,
      input.patch,
      { directMerge: true, conflation: { ...options, decisions: [remove] } },
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
    expect(() => generate(input, [remove], config)).toThrow(/way-removal-connection-required/);
    const output = generate(input, [connect, remove], config);
    expect(output.result.ways.ids.has(20)).toBe(false);
    expect(output.result.ways.getById(30)?.refs).toEqual([2, 103]);
    expect(output.result.nodes.ids.has(101)).toBe(false);
    // 102 was orphaned by the separately selected attachment, not by removing way20.
    expect(output.result.nodes.ids.has(102)).toBe(true);
    expect(output.outcome.summary).toMatchObject({ wayRemovalActions: 1, removedOrphanNodes: 1 });
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
      expect(() => generate(input, [remove], config)).toThrow(/way-removal-connection-required/);
      expect(() =>
        generate(input, [{ ...connect, attachNetwork: undefined }, remove], config),
      ).toThrow(/way-removal-connection-required/);
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
    expect(() => generate(input)).toThrow(/Cannot remove/);
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
    expect(() => generate(input)).toThrow(/relation-member/);
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
    expect(() => generate(input, [{ ...remove, candidateId: candidate!.id }])).toThrow(
      /Cannot remove/,
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
    expect(() => generate(input)).toThrow(/relation-member/);
  });
  it("checks non-routing branches rather than ignoring them", () => {
    const input = fixture({ branch: true, branchTags: { natural: "tree_row" } });
    expect(() => generate(input, [connect, remove], { ...options, attachNetwork: true })).toThrow(
      /connection-required/,
    );
  });
  it("supports reversed equivalent direction aliases and blocks other directional meanings", () => {
    expect(
      generate(
        fixture({ reversed: true, sourceTags: { oneway: "yes" }, targetTags: { oneway: "-1" } }),
      ).result.ways.ids.has(20),
    ).toBe(false);
    expect(() =>
      generate(
        fixture({ reversed: true, sourceTags: { incline: "5%" }, targetTags: { incline: "5%" } }),
      ),
    ).toThrow(/routing-conflict/);
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
    expect(() =>
      generate(
        { base, patch },
        [connect, remove, { ...remove, candidateId: "way:30->11" }],
        config,
      ),
    ).toThrow(/topology-conflict/);
    expect(base.ways.ids.has(10)).toBe(true);
    expect(patch.ways.ids.has(20)).toBe(true);
  });
  it("rejects an exact-stage remap that makes the reviewed deletion obsolete", () => {
    const input = fixture();
    const patch = osm(
      "patch",
      [...input.patch.nodes].map((node) => ({ ...node, lat: 0 })),
      [...input.patch.ways],
    );
    expect(() =>
      generateConflationArtifacts(
        input.base,
        patch,
        { directMerge: true, deduplicateNodes: true, conflation: options },
        [remove],
      ),
    ).toThrow(/topology-conflict/);
  });
  it("rechecks unexpected branches in the actual ordinary baseline", () => {
    const input = fixture();
    const discovery = discover(input);
    const ordinary = applyChangesetToOsm(
      generateChangeset(input.base, input.patch, { directMerge: true }),
    );
    const unexpected = osm(
      "base",
      [...ordinary.nodes],
      [...ordinary.ways, { id: 70, refs: [101, 103], tags: { highway: "footway" } }],
    );
    expect(() =>
      generateConflationApplicationChangeset(unexpected, input.patch, discovery, input.base, [
        remove,
      ]),
    ).toThrow(/connection-required/);
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
    expect(() => generate(input)).toThrow(/routing-conflict/);
  });
  it("rechecks direction after selected tag copies change the retained way", () => {
    const input = fixture({
      reversed: true,
      sourceTags: { oneway: "yes" },
      targetTags: { oneway: "-1" },
    });
    expect(() =>
      generate(input, [{ ...remove, transferProperties: true }], {
        ...options,
        propertyKeys: ["oneway"],
      }),
    ).toThrow(/routing-conflict/);
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
    expect(() => generate({ base: input.base, patch: withoutTarget })).toThrow(/relation-member/);
  });
  it("does not trust edited caller evidence or a changed ordinary baseline", () => {
    const input = fixture({ branch: true });
    const discovery = discover(input, { ...options, attachNetwork: true });
    const candidate = discovery.candidates.find(
      (candidate) => candidate.id === remove.candidateId,
    )!;
    candidate.wayRemoval!.status = "review";
    candidate.wayRemoval!.reasons = [];
    const baseline = applyChangesetToOsm(
      generateChangeset(input.base, input.patch, { directMerge: true }),
    );
    expect(() =>
      generateConflationApplicationChangeset(baseline, input.patch, discovery, input.base, [
        remove,
      ]),
    ).toThrow(/connection-required/);
    const simple = fixture();
    const safeDiscovery = discover(simple);
    const changed = applyChangesetToOsm(
      generateChangeset(simple.base, simple.patch, { directMerge: true }),
    );
    const unexpected = osm(
      "base",
      [...changed.nodes],
      [...changed.ways].map((way) => (way.id === 20 ? { ...way, refs: [101, 103] } : way)),
    );
    expect(() =>
      generateConflationApplicationChangeset(unexpected, simple.patch, safeDiscovery, simple.base, [
        remove,
      ]),
    ).toThrow(/topology-conflict/);
  });
});
