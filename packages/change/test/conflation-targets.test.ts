import { Osm } from "@osmix/core";
import { describe, expect, it, vi } from "vitest";

import { OsmChangeset } from "../src/changeset.ts";
import {
  buildConflationBulkDecisionResult,
  buildConflationSourceDecision,
  discoverConflationCandidates,
  generateConflationChangeset,
  resolveConflationActions,
  validateConflationDecisions,
} from "../src/conflation.ts";
import * as publicChangeApi from "../src/index.ts";
import { validateRetainedConflationReview } from "../src/internal/conflation.ts";
import { merge } from "../src/merge.ts";
import type { OsmConflationCandidate, OsmConflationDecision } from "../src/types.ts";

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

describe("one selected target per imported feature", () => {
  it("rejects a copy/connection split across targets at decision validation", () => {
    const { discovery, first, second } = createFixture();
    expect(first.propertyTransfer.status).toBe("review");
    expect(second.networkAttachment?.status).toBe("review");
    const decisions = conflicts();
    const before = structuredClone(decisions);
    expect(() => validateConflationDecisions(discovery.candidates, decisions)).toThrow(
      /imported node 101.*node:101->1.*node:101->2/,
    );
    try {
      validateConflationDecisions(discovery.candidates, decisions);
    } catch (error) {
      expect(error).toMatchObject({
        conflict: {
          entityType: "node",
          sourceId: 101,
          candidateIds: [first.id, second.id],
          message: expect.stringContaining("Choose one target or skip"),
        },
      });
      expect(Object.keys(error ?? {})).toContain("conflict");
    }
    expect(decisions).toEqual(before);
  });

  it("validates legacy omitted flags as scheduled actions", () => {
    const { discovery } = createFixture();
    expect(() =>
      validateConflationDecisions(discovery.candidates, [
        { candidateId: "node:101->1", action: "accept" },
        { candidateId: "node:101->2", action: "accept" },
      ]),
    ).toThrow(/imported node 101/);
  });

  it("rejects conflicts before preparing any ordinary merge changes", () => {
    const { base, patch, options } = createFixture();
    const generateDirect = vi.spyOn(OsmChangeset.prototype, "generateDirectChanges");
    try {
      expect(() =>
        generateConflationChangeset(base, patch, {
          directMerge: true,
          conflation: { ...options, decisions: conflicts() },
        }),
      ).toThrow();
      expect(generateDirect).not.toHaveBeenCalled();
    } finally {
      generateDirect.mockRestore();
    }
  });

  it("does not silently repair a conflicting external snapshot through a bulk rejection", () => {
    const { discovery } = createFixture();
    expect(() =>
      buildConflationBulkDecisionResult(discovery.candidates, conflicts(), {
        action: "reject",
        filter: { sourceId: 101 },
      }),
    ).toThrow(/imported node 101/);
  });

  it("limits legacy review restoration to an internal capability without approving generation", () => {
    const { discovery } = createFixture();
    const decisions = conflicts();
    expect(publicChangeApi).not.toHaveProperty("validateRetainedConflationReview");
    expect(() => validateRetainedConflationReview(discovery.candidates, decisions)).not.toThrow();
    expect(() => validateConflationDecisions(discovery.candidates, decisions)).toThrow(
      /imported node 101/,
    );
    expect(() =>
      validateRetainedConflationReview(discovery.candidates, [
        { candidateId: "node:101->99", action: "accept" },
      ]),
    ).toThrow("Unknown conflation candidate");
    expect(() =>
      validateRetainedConflationReview(discovery.candidates, [decisions[0]!, decisions[0]!]),
    ).toThrow("Duplicate conflation decision");
  });

  it("atomically replaces a target and regenerates while preserving unrelated choices", async () => {
    const { base, patch, options, discovery, first, second, unrelated } = createFixture();
    const otherDecision: OsmConflationDecision = {
      candidateId: unrelated.id,
      action: "accept",
      transferProperties: false,
      attachNetwork: true,
    };
    const current = [...conflicts(), otherDecision];
    const selected: OsmConflationDecision = {
      candidateId: second.id,
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    };
    const before = structuredClone(current);
    const decisions = buildConflationSourceDecision(discovery.candidates, current, first, selected);
    expect(decisions).toEqual([
      { candidateId: first.id, action: "reject" },
      selected,
      otherDecision,
    ]);
    expect(current).toEqual(before);
    expect(decisions.find((decision) => decision.candidateId === unrelated.id)).not.toBe(
      otherDecision,
    );
    expect(decisions.find((decision) => decision.candidateId === selected.candidateId)).not.toBe(
      selected,
    );
    expect(() => validateConflationDecisions(discovery.candidates, decisions)).not.toThrow();
    expect(() => validateConflationDecisions(discovery.candidates, current)).toThrow(
      /imported node 101/,
    );
    const result = await merge(
      base,
      patch,
      { directMerge: true, conflation: { ...options, decisions } },
      () => {},
    );
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("A");
    expect(result.nodes.getById(2)?.tags?.["name"]).toBe("Imported");
    expect(result.nodes.getById(3)?.tags?.["name"]).toBe("Other");
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
    expect(result.ways.getById(21)?.refs).toEqual([3, 202]);
    expect(base.nodes.getById(2)?.tags?.["name"]).toBe("B");
    expect(patch.ways.getById(21)?.refs).toEqual([201, 202]);
  });

  it("leaves a source unmatched by rejecting every alternative without changing other sources", () => {
    const { discovery, first, second, unrelated } = createFixture();
    const otherDecision: OsmConflationDecision = { candidateId: unrelated.id, action: "reject" };
    const decisions = buildConflationSourceDecision(
      discovery.candidates,
      [...conflicts(), otherDecision],
      first,
      null,
    );
    expect(decisions).toEqual([
      { candidateId: first.id, action: "reject" },
      { candidateId: second.id, action: "reject" },
      otherDecision,
    ]);
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
  });

  it("includes automatic defaults in validation and explicitly prevents sibling defaults resurfacing", () => {
    const { first, second } = createFixture();
    const candidates: OsmConflationCandidate[] = [first, second].map((candidate) => ({
      ...candidate,
      status: "automatic",
      propertyTransfer: { status: "automatic", reasons: [] },
      networkAttachment: { status: "automatic", reasons: [] },
    }));
    expect(() => validateConflationDecisions(candidates, [])).toThrow(/imported node 101/);
    const selected: OsmConflationDecision = {
      candidateId: first.id,
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    };
    const next = buildConflationSourceDecision(candidates, [], first, selected);
    expect(next).toEqual([selected, { candidateId: second.id, action: "reject" }]);
    expect(() => validateConflationDecisions(candidates, next)).not.toThrow();
    const skipped = buildConflationSourceDecision(candidates, next, first, null);
    expect(skipped.every((decision) => decision.action === "reject")).toBe(true);
    expect(() => validateConflationDecisions(candidates, skipped)).not.toThrow();
  });

  it("does not count hard-blocked requested actions as another selected target", async () => {
    const { base, patch, options, discovery, first, second } = createFixture(true);
    expect(second.propertyTransfer.status).toBe("blocked");
    expect(second.networkAttachment?.status).toBe("blocked");
    const decisions: OsmConflationDecision[] = [
      { candidateId: first.id, action: "accept", transferProperties: true, attachNetwork: false },
      { candidateId: second.id, action: "accept" },
    ];
    expect(() => validateConflationDecisions(discovery.candidates, decisions)).not.toThrow();
    expect(resolveConflationActions(second, decisions[1])).toEqual({
      transferProperties: false,
      attachNetwork: false,
    });
    const blockedSelection = buildConflationSourceDecision(
      discovery.candidates,
      decisions,
      first,
      decisions[1]!,
    );
    const result = await merge(
      base,
      patch,
      { directMerge: true, conflation: { ...options, decisions: blockedSelection } },
      () => {},
    );
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe("A");
    expect(result.nodes.getById(2)?.tags?.["name"]).toBe("B");
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
  });

  it("rejects stale snapshots and selections that belong to a different source", () => {
    const { discovery, first, unrelated } = createFixture();
    const stale: OsmConflationDecision[] = [{ candidateId: "node:101->99", action: "accept" }];
    expect(() => validateConflationDecisions(discovery.candidates, stale)).toThrow(
      "Unknown conflation candidate",
    );
    expect(() => buildConflationSourceDecision(discovery.candidates, stale, first, null)).toThrow(
      "Unknown conflation candidate",
    );
    expect(() =>
      buildConflationSourceDecision(discovery.candidates, [], first, {
        candidateId: unrelated.id,
        action: "accept",
      }),
    ).toThrow(`Candidate ${unrelated.id} does not match imported node 101`);
    expect(() =>
      buildConflationSourceDecision(
        discovery.candidates,
        [],
        {
          entityType: "node",
          sourceId: 999,
        },
        null,
      ),
    ).toThrow("No conflation candidates for imported node 999");
  });

  it("repairs legacy conflicts one source at a time without changing unrelated selections", () => {
    const { discovery, first, unrelated } = createFixture();
    const alternate: OsmConflationCandidate = {
      ...unrelated,
      id: "node:201->4",
      targetId: 4,
      status: "review",
    };
    const decisions: OsmConflationDecision[] = [
      ...conflicts(),
      { candidateId: unrelated.id, action: "accept" },
      { candidateId: alternate.id, action: "accept" },
    ];
    const candidates = [...discovery.candidates, alternate];
    const firstRepair = buildConflationSourceDecision(candidates, decisions, first, null);
    expect(firstRepair.filter((decision) => decision.candidateId.startsWith("node:201->"))).toEqual(
      decisions.filter((decision) => decision.candidateId.startsWith("node:201->")),
    );
    expect(() => validateConflationDecisions(candidates, firstRepair)).toThrow(
      /imported node 201.*node:201->3.*node:201->4/,
    );
    const secondRepair = buildConflationSourceDecision(candidates, firstRepair, unrelated, {
      candidateId: unrelated.id,
      action: "accept",
    });
    expect(() => validateConflationDecisions(candidates, secondRepair)).not.toThrow();
    expect(secondRepair).toContainEqual({ candidateId: alternate.id, action: "reject" });
    expect(
      secondRepair.filter((decision) => decision.candidateId.startsWith("node:101->")),
    ).toEqual(firstRepair.filter((decision) => decision.candidateId.startsWith("node:101->")));
    expect(() => validateConflationDecisions(candidates, decisions)).toThrow(/imported node 101/);
  });

  it("keeps a way with the same numeric source ID independent from node alternatives", () => {
    const { discovery, first } = createFixture();
    const way: OsmConflationCandidate = {
      ...first,
      entityType: "way",
      id: "way:101->10",
      sourceId: 101,
      targetId: 10,
      networkAttachment: null,
    };
    const wayDecision: OsmConflationDecision = { candidateId: way.id, action: "accept" };
    const decisions = buildConflationSourceDecision(
      [...discovery.candidates, way],
      [...conflicts(), wayDecision],
      first,
      null,
    );
    expect(decisions).toContainEqual(wayDecision);
  });

  it("cannot introduce a target collision while preserving unrelated legacy source conflicts", () => {
    const { discovery, first, unrelated } = createFixture();
    const unrelatedAlternative: OsmConflationCandidate = {
      ...unrelated,
      id: "node:201->4",
      targetId: 4,
    };
    const occupiedTarget: OsmConflationCandidate = {
      ...first,
      id: "node:101->3",
      targetId: 3,
    };
    const decisions: OsmConflationDecision[] = [
      ...conflicts(),
      { candidateId: unrelated.id, action: "accept" },
      { candidateId: unrelatedAlternative.id, action: "accept" },
    ];
    const before = structuredClone(decisions);
    expect(() =>
      buildConflationSourceDecision(
        [...discovery.candidates, unrelatedAlternative, occupiedTarget],
        decisions,
        first,
        {
          candidateId: occupiedTarget.id,
          action: "accept",
          transferProperties: false,
          attachNetwork: true,
        },
      ),
    ).toThrow("multiple node attachments to 3");
    expect(decisions).toEqual(before);
  });

  it.each(["transfer-properties", "attach-network"] as const)(
    "bulk %s conservatively skips alternatives even after a target is selected",
    (action) => {
      const { discovery, first } = createFixture();
      const selected: OsmConflationDecision = {
        candidateId: first.id,
        action: "accept",
        transferProperties: true,
        attachNetwork: false,
      };
      const decisions = buildConflationSourceDecision(discovery.candidates, [], first, selected);
      const result = buildConflationBulkDecisionResult(discovery.candidates, decisions, {
        action,
        filter: { entityType: first.entityType, sourceId: first.sourceId },
      });
      expect(result.preview).toMatchObject({
        filteredCandidates: 2,
        eligibleCandidates: 0,
        changedCandidates: 0,
      });
      expect(result.decisions).toEqual(decisions);
      expect(
        buildConflationBulkDecisionResult(discovery.candidates, [], {
          action,
          filter: { entityType: first.entityType, sourceId: first.sourceId },
        }).decisions,
      ).toEqual([]);
    },
  );

  it("still rejects two source attachments to the same base node", () => {
    const { first } = createFixture();
    const other: OsmConflationCandidate = { ...first, id: "node:301->1", sourceId: 301 };
    const decisions: OsmConflationDecision[] = [
      { candidateId: first.id, action: "accept", transferProperties: false, attachNetwork: true },
      { candidateId: other.id, action: "accept", transferProperties: false, attachNetwork: true },
    ];
    for (const validate of [validateConflationDecisions, validateRetainedConflationReview]) {
      expect(() => validate([first, other], decisions)).toThrow("multiple node attachments to 1");
    }
  });

  it("still rejects transferring two imported ways to the same base way", () => {
    const { first } = createFixture();
    const ways: OsmConflationCandidate[] = [20, 21].map((sourceId) => ({
      ...first,
      entityType: "way",
      id: `way:${sourceId}->10`,
      sourceId,
      targetId: 10,
      networkAttachment: null,
    }));
    const decisions: OsmConflationDecision[] = ways.map((candidate) => ({
      candidateId: candidate.id,
      action: "accept",
    }));
    for (const validate of [validateConflationDecisions, validateRetainedConflationReview]) {
      expect(() => validate(ways, decisions)).toThrow("multiple ways for target 10");
    }
  });
});
