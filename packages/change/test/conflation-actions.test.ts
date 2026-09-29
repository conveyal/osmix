import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import {
  discoverConflationCandidates,
  resolveConflationActions,
  summarizeConflationCandidates,
} from "../src/conflation.ts";
import { merge } from "../src/merge.ts";
import type { MergePlan, PlanProposalEffect } from "../src/plan/types.ts";
import type {
  OsmConflationAutomatic,
  OsmConflationCandidate,
  OsmConflationDecision,
  OsmConflationEffectiveStatus,
  OsmConflationOptions,
} from "../src/types.ts";
import { findProposal, planAndApply, withMatchingDecisions } from "./helpers/plan.ts";

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

/** The effective status of one candidate under `decisions`, as the review counts see it. */
function effectiveStatus(
  candidate: OsmConflationCandidate,
  decisions: readonly OsmConflationDecision[],
): OsmConflationEffectiveStatus {
  const summary = summarizeConflationCandidates([candidate], decisions);
  const statuses = ["accepted", "automatic", "review", "blocked", "unmatched", "rejected"] as const;
  const status = statuses.find((key) => summary[key] === 1);
  if (!status) throw Error(`No status for ${candidate.id}`);
  return status;
}

/** Plan the fixture's merge with matching decisions written as candidate decisions. */
function planFixture(
  base: Osm,
  patch: Osm,
  matching: Omit<OsmConflationOptions, "decisions">,
  decisions: readonly OsmConflationDecision[],
) {
  return planAndApply(
    base,
    patch,
    withMatchingDecisions(
      base,
      patch,
      { mergeIdenticalPoints: false, createIntersections: false, matching },
      decisions,
    ),
  );
}

/** What the plan does with the fixture's copy and connect proposals. */
function actionEffects(plan: MergePlan) {
  return {
    copy: findProposal(plan, "copy:n101>n1").effect,
    connect: findProposal(plan, "connect:n101>n1").effect,
  };
}

function expectedEffect(selected: boolean, status: OsmConflationEffectiveStatus) {
  if (selected) return "applied" satisfies PlanProposalEffect;
  return status === "review" ? "needs-decision" : "skipped";
}

describe("resolved matching actions", () => {
  it.each(scenarios)("resolves and plans $name consistently", async (scenario) => {
    const { base, patch, options, candidate } = createFixture(false, scenario.automatic);
    const decisions = scenario.decision ? [scenario.decision] : [];
    expect(resolveConflationActions(candidate, scenario.decision)).toEqual({
      transferProperties: scenario.transferProperties,
      attachNetwork: scenario.attachNetwork,
    });
    expect(effectiveStatus(candidate, decisions)).toBe(scenario.status);
    const { plan } = planFixture(base, patch, options, decisions);
    expect(actionEffects(plan)).toEqual({
      copy: expectedEffect(scenario.transferProperties, scenario.status),
      connect: expectedEffect(scenario.attachNetwork, scenario.status),
    });
    const result = await merge(
      base,
      patch,
      withMatchingDecisions(
        base,
        patch,
        { mergeIdenticalPoints: false, createIntersections: false, matching: options },
        decisions,
      ),
      () => {},
    );
    expect(result.nodes.getById(1)?.tags?.["name"]).toBe(
      scenario.transferProperties ? "Imported" : "Base",
    );
    expect(result.ways.getById(20)?.refs).toEqual(scenario.attachNetwork ? [1, 102] : [101, 102]);
    expect(result.nodes.getById(101)).toEqual(patch.nodes.getById(101));
    expect(result.ways.getById(10)).toEqual(base.ways.getById(10));
  });

  it("treats neither action as skipped in the plan, its result, status, and summaries", () => {
    const { base, patch, options, discovery, candidate } = createFixture();
    const decision: OsmConflationDecision = {
      candidateId: candidate.id,
      action: "accept",
      transferProperties: false,
      attachNetwork: false,
    };
    const { plan, osm: result } = planFixture(base, patch, options, [decision]);
    expect(result.nodes.getById(1)?.tags).toEqual({ name: "Base" });
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
    expect(actionEffects(plan)).toEqual({ copy: "skipped", connect: "skipped" });
    expect(plan.matching?.outcome.summary).toMatchObject({ appliedFeatures: 0 });
    expect(effectiveStatus(candidate, [decision])).toBe("rejected");
    expect(summarizeConflationCandidates(discovery.candidates, [decision])).toMatchObject({
      automatic: 0,
      rejected: 1,
    });
  });

  it("never enables blocked attachment and preserves safe copying independently", () => {
    const { base, patch, options, candidate } = createFixture(true);
    expect(candidate.networkAttachment?.status).toBe("blocked");
    const legacy: OsmConflationDecision = { candidateId: candidate.id, action: "accept" };
    expect(resolveConflationActions(candidate, legacy)).toEqual({
      transferProperties: true,
      attachNetwork: false,
    });
    const blockedOnly: OsmConflationDecision = {
      candidateId: candidate.id,
      action: "accept",
      transferProperties: false,
      attachNetwork: true,
    };
    expect(resolveConflationActions(candidate, blockedOnly)).toEqual({
      transferProperties: false,
      attachNetwork: false,
    });
    expect(effectiveStatus(candidate, [blockedOnly])).toBe("blocked");

    // Accepting the blocked connection itself changes nothing.
    const accepted = planAndApply(base, patch, {
      mergeIdenticalPoints: false,
      createIntersections: false,
      matching: options,
      decisions: [
        { proposalId: "connect:n101>n1", action: "accept" },
        { proposalId: "copy:n101>n1", action: "reject" },
      ],
    });
    expect(actionEffects(accepted.plan)).toEqual({ copy: "skipped", connect: "blocked" });
    expect(accepted.osm.ways.getById(20)?.refs).toEqual([101, 102]);

    const copyOnly: OsmConflationDecision = {
      candidateId: candidate.id,
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    };
    const { plan, osm: result } = planFixture(base, patch, options, [copyOnly]);
    expect(actionEffects(plan)).toEqual({ copy: "applied", connect: "blocked" });
    expect(result.nodes.getById(1)?.tags).toEqual({ name: "Imported" });
    expect(result.ways.getById(20)?.refs).toEqual([101, 102]);
  });

  it("keeps network attachment eligible when there are no tags to copy", () => {
    const { base, patch, options, candidate } = createFixture(false, "high-confidence", []);
    expect(candidate.propertyTransfer.status).toBe("blocked");
    const decision: OsmConflationDecision = { candidateId: candidate.id, action: "accept" };
    expect(resolveConflationActions(candidate, decision)).toEqual({
      transferProperties: false,
      attachNetwork: true,
    });
    const { plan, osm: result } = planFixture(base, patch, options, [decision]);
    expect(actionEffects(plan)).toEqual({ copy: "blocked", connect: "applied" });
    expect(result.ways.getById(20)?.refs).toEqual([1, 102]);
  });
});
