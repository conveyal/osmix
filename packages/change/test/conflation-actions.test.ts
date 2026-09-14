import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import {
  buildConflationActionDecision,
  buildConflationBulkDecisionResult,
  conflationEffectiveStatus,
  discoverConflationCandidates,
  filterConflationCandidates,
  resolveConflationActions,
  summarizeConflationCandidates,
} from "../src/conflation.ts";
import { merge } from "../src/merge.ts";
import type {
  OsmConflationAutomatic,
  OsmConflationDecision,
  OsmConflationEffectiveStatus,
} from "../src/types.ts";

interface DecisionScenario {
  name: string;
  decision?: OsmConflationDecision;
  automatic?: OsmConflationAutomatic;
  transferProperties: boolean;
  attachNetwork: boolean;
  status: OsmConflationEffectiveStatus;
}

const scenarios: DecisionScenario[] = [
  {
    name: "automatic defaults",
    transferProperties: true,
    attachNetwork: true,
    status: "automatic",
  },
  {
    name: "copy only",
    decision: {
      candidateId: "node:101->1",
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    },
    transferProperties: true,
    attachNetwork: false,
    status: "accepted",
  },
  {
    name: "connect only",
    decision: {
      candidateId: "node:101->1",
      action: "accept",
      transferProperties: false,
      attachNetwork: true,
    },
    transferProperties: false,
    attachNetwork: true,
    status: "accepted",
  },
  {
    name: "both actions",
    decision: {
      candidateId: "node:101->1",
      action: "accept",
      transferProperties: true,
      attachNetwork: true,
    },
    transferProperties: true,
    attachNetwork: true,
    status: "accepted",
  },
  {
    name: "neither action",
    decision: {
      candidateId: "node:101->1",
      action: "accept",
      transferProperties: false,
      attachNetwork: false,
    },
    transferProperties: false,
    attachNetwork: false,
    status: "rejected",
  },
  {
    name: "rejection overrides saved action flags",
    decision: {
      candidateId: "node:101->1",
      action: "reject",
      transferProperties: true,
      attachNetwork: true,
    },
    transferProperties: false,
    attachNetwork: false,
    status: "rejected",
  },
  {
    name: "legacy acceptance selects eligible actions",
    decision: { candidateId: "node:101->1", action: "accept" },
    transferProperties: true,
    attachNetwork: true,
    status: "accepted",
  },
  {
    name: "legacy acceptance preserves omitted flag defaults",
    decision: { candidateId: "node:101->1", action: "accept", transferProperties: false },
    transferProperties: false,
    attachNetwork: true,
    status: "accepted",
  },
  {
    name: "manual review has no automatic defaults",
    automatic: "none",
    transferProperties: false,
    attachNetwork: false,
    status: "review",
  },
];

function createFixture(
  blockedAttachment = false,
  automatic: OsmConflationAutomatic = "high-confidence",
  propertyKeys = ["name"],
) {
  const base = new Osm({ id: "base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { name: "Base" } });
  base.nodes.addNode({ id: 2, lon: -0.001, lat: 0 });
  base.ways.addWay({ id: 10, refs: [2, 1], tags: { highway: "footway" } });
  base.buildIndexes();
  base.buildSpatialIndexes();
  const patch = new Osm({ id: "patch" });
  patch.nodes.addNode({
    id: 101,
    lon: 0.000005,
    lat: 0,
    tags: { name: "Imported", ...(blockedAttachment ? { access: "private" } : {}) },
  });
  patch.nodes.addNode({ id: 102, lon: 0.001, lat: 0 });
  patch.ways.addWay({ id: 20, refs: [101, 102], tags: { highway: "footway" } });
  patch.buildIndexes();
  patch.buildSpatialIndexes();
  const options = { propertyKeys, attachNetwork: true, automatic };
  const discovery = discoverConflationCandidates(base, patch, options);
  const candidate = discovery.candidates.find((item) => item.id === "node:101->1");
  if (!candidate) throw Error("Fixture did not discover the expected node match");
  return { base, patch, options, discovery, candidate };
}

describe("resolved matching actions", () => {
  it.each(scenarios)("resolves and generates $name consistently", async (scenario) => {
    const { base, patch, options, candidate } = createFixture(false, scenario.automatic);
    const decisions = scenario.decision ? [scenario.decision] : [];
    expect(resolveConflationActions(candidate, scenario.decision)).toEqual({
      transferProperties: scenario.transferProperties,
      attachNetwork: scenario.attachNetwork,
    });
    expect(conflationEffectiveStatus(candidate, decisions)).toBe(scenario.status);
    const result = await merge(
      base,
      patch,
      { directMerge: true, conflation: { ...options, decisions } },
      () => {},
    );
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe(
      scenario.transferProperties ? "Imported" : "Base",
    );
    expect(result.ways.getById(20)?.refs).toEqual(scenario.attachNetwork ? [1, 102] : [101, 102]);
    expect(result.nodes.getById(101)).toEqual(patch.nodes.getById(101));
    expect(result.ways.getById(10)).toEqual(base.ways.getById(10));
  });

  it("treats neither action as skipped in generated output, status, summaries, and filters", async () => {
    const { base, patch, options, discovery, candidate } = createFixture();
    const decision: OsmConflationDecision = {
      candidateId: candidate.id,
      action: "accept",
      transferProperties: false,
      attachNetwork: false,
    };
    const result = await merge(
      base,
      patch,
      { directMerge: true, conflation: { ...options, decisions: [decision] } },
      () => {},
    );
    expect(result.nodes.getById(1)?.tags).toEqual({ name: "Base" });
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
    expect(conflationEffectiveStatus(candidate, [decision])).toBe("rejected");
    expect(summarizeConflationCandidates(discovery.candidates, [decision])).toMatchObject({
      automatic: 0,
      rejected: 1,
    });
    expect(
      filterConflationCandidates(discovery.candidates, { status: "rejected" }, [decision]),
    ).toContainEqual(candidate);
  });

  it("changes one row choice while preserving the other, including automatic defaults", () => {
    const { candidate } = createFixture();
    const connectOnly = buildConflationActionDecision(
      candidate,
      undefined,
      "transfer-properties",
      false,
    );
    expect(connectOnly).toEqual({
      candidateId: candidate.id,
      action: "accept",
      transferProperties: false,
      attachNetwork: undefined,
    });
    expect(resolveConflationActions(candidate, connectOnly)).toEqual({
      transferProperties: false,
      attachNetwork: true,
    });
    const confirmation = buildConflationBulkDecisionResult([candidate], [connectOnly], {
      action: "attach-network",
      filter: {},
    });
    expect(confirmation.preview.changedCandidates).toBe(1);
    expect(confirmation.decisions[0]?.attachNetwork).toBe(true);
    const neither = buildConflationActionDecision(candidate, connectOnly, "attach-network", false);
    expect(resolveConflationActions(candidate, neither)).toEqual({
      transferProperties: false,
      attachNetwork: false,
    });
    expect(conflationEffectiveStatus(candidate, [neither])).toBe("rejected");
    const copyOnly = buildConflationActionDecision(candidate, neither, "transfer-properties", true);
    expect(resolveConflationActions(candidate, copyOnly)).toEqual({
      transferProperties: true,
      attachNetwork: false,
    });
    const both = buildConflationActionDecision(candidate, copyOnly, "attach-network", true);
    expect(resolveConflationActions(candidate, both)).toEqual({
      transferProperties: true,
      attachNetwork: true,
    });
    expect(resolveConflationActions(candidate)).toEqual(resolveConflationActions(candidate, both));
  });

  it.each(scenarios)("row and bulk choices agree after $name", (scenario) => {
    const { candidate, discovery } = createFixture(false, scenario.automatic);
    const actions = ["transfer-properties", "attach-network"] as const;
    for (const action of actions) {
      const row = buildConflationActionDecision(candidate, scenario.decision, action, true);
      const bulk = buildConflationBulkDecisionResult(
        discovery.candidates,
        scenario.decision ? [scenario.decision] : [],
        { action, filter: { sourceId: candidate.sourceId } },
      );
      const bulkDecision = bulk.decisions.find((decision) => decision.candidateId === candidate.id);
      expect(bulk.preview.eligibleCandidates).toBe(1);
      expect(resolveConflationActions(candidate, bulkDecision)).toEqual(
        resolveConflationActions(candidate, row),
      );
      expect(resolveConflationActions(candidate, row)).toEqual({
        transferProperties: action === "transfer-properties" || scenario.transferProperties,
        attachNetwork: action === "attach-network" || scenario.attachNetwork,
      });
    }
  });

  it("never enables blocked attachment and preserves safe copying independently", async () => {
    const { base, patch, options, candidate, discovery } = createFixture(true);
    expect(candidate.networkAttachment?.status).toBe("blocked");
    const legacy: OsmConflationDecision = { candidateId: candidate.id, action: "accept" };
    expect(resolveConflationActions(candidate, legacy)).toEqual({
      transferProperties: true,
      attachNetwork: false,
    });
    const neither = buildConflationActionDecision(candidate, legacy, "transfer-properties", false);
    const blockedOnly = buildConflationActionDecision(candidate, neither, "attach-network", true);
    expect(resolveConflationActions(candidate, blockedOnly)).toEqual({
      transferProperties: false,
      attachNetwork: false,
    });
    expect(conflationEffectiveStatus(candidate, [blockedOnly])).toBe("blocked");
    const row = buildConflationActionDecision(candidate, blockedOnly, "transfer-properties", true);
    const bulk = buildConflationBulkDecisionResult(discovery.candidates, [blockedOnly], {
      action: "transfer-properties",
      filter: { sourceId: candidate.sourceId },
    });
    expect(bulk.decisions).toEqual([row]);
    expect(row).toMatchObject({ transferProperties: true, attachNetwork: false });
    const blockedBulk = buildConflationBulkDecisionResult(discovery.candidates, [row], {
      action: "attach-network",
      filter: { sourceId: candidate.sourceId },
    });
    expect(blockedBulk.preview.eligibleCandidates).toBe(0);
    expect(blockedBulk.decisions).toEqual([row]);
    const result = await merge(
      base,
      patch,
      { directMerge: true, conflation: { ...options, decisions: [row] } },
      () => {},
    );
    expect(result.nodes.getById(1)?.tags).toEqual({ name: "Imported" });
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
  });

  it("keeps network attachment eligible when there are no tags to copy", () => {
    const { candidate, discovery } = createFixture(false, "high-confidence", []);
    expect(candidate.propertyTransfer.status).toBe("blocked");
    const decision: OsmConflationDecision = { candidateId: candidate.id, action: "accept" };
    expect(resolveConflationActions(candidate, decision)).toEqual({
      transferProperties: false,
      attachNetwork: true,
    });
    const bulk = buildConflationBulkDecisionResult(discovery.candidates, [], {
      action: "transfer-properties",
      filter: { sourceId: candidate.sourceId },
    });
    expect(bulk.preview.eligibleCandidates).toBe(0);
    expect(bulk.decisions).toEqual([]);
  });
});
