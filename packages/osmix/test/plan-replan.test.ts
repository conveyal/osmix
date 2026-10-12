/**
 * Changing a plan's decisions replans only the phases they affect. The result must be the plan
 * a fresh `planMerge` makes with the same decisions, for any sequence of decisions.
 */
import { readFileSync } from "node:fs";

import {
  applyPlan,
  type MergePlan,
  type PlanDecision,
  planMerge,
  setMergePlanDecisions,
} from "@osmix/change";
import type { Osm } from "@osmix/core";
import { fromPbf } from "@osmix/load";
import { getFixtureFileReadStream, getFixturePath } from "@osmix/test-utils/fixtures";
import {
  MONACO_MERGE_CONFLATION,
  MONACO_MERGE_PATCH,
} from "@osmix/test-utils/monaco-merge-scenarios";
import { beforeAll, describe, expect, it } from "vitest";

import { fromGeoJSON } from "../src/index.ts";

const quiet = () => {};
const matching = {
  ...MONACO_MERGE_CONFLATION,
  propertyKeys: [...MONACO_MERGE_CONFLATION.propertyKeys],
};

let base: Osm;
let patch: Osm;

beforeAll(async () => {
  base = await fromPbf(getFixtureFileReadStream("monaco.pbf"), { id: "monaco" });
  patch = await fromGeoJSON(readFileSync(getFixturePath(MONACO_MERGE_PATCH), "utf8"), {
    id: "monaco-merge-patch",
  });
});

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Everything a caller can read from a plan, plus what applying it produces. */
function observable(plan: MergePlan) {
  let applied: { contentHash: string } | { error: string };
  try {
    applied = { contentHash: applyPlan(plan).osm.contentHash() };
  } catch (error) {
    applied = { error: error instanceof Error ? error.message : String(error) };
  }
  return {
    features: plan.features.map(({ key, outcome, proposalIds }) => ({
      key,
      outcome,
      proposalIds: [...proposalIds].toSorted(),
    })),
    proposals: [...plan.proposals.values()].map((proposal) => JSON.stringify(proposal)).toSorted(),
    summary: plan.summary,
    staleDecisions: plan.staleDecisions.toSorted(),
    diagnostics: plan.diagnostics,
    matching: plan.matching,
    applied,
  };
}

describe("setMergePlanDecisions", () => {
  it.each([1, 2, 3])(
    "matches a fresh plan after random decisions (seed %i)",
    (seed) => {
      const random = mulberry32(seed);
      const plan = planMerge(base, patch, { matching }, quiet);
      const decisions = new Map<string, PlanDecision["action"]>();
      for (let step = 0; step < 6; step++) {
        const decidable = [...plan.proposals.values()].filter(
          (proposal) => proposal.kind !== "add" && proposal.kind !== "same-id-replace",
        );
        const proposal = decidable[Math.floor(random() * decidable.length)]!;
        const roll = random();
        if (roll < 0.2) decisions.delete(proposal.id);
        else decisions.set(proposal.id, roll < 0.6 ? "accept" : "reject");
        const list = [...decisions].map(([proposalId, action]) => ({ proposalId, action }));
        setMergePlanDecisions(plan, list);
        const fresh = planMerge(base, patch, { matching, decisions: list }, quiet);
        expect(observable(plan), `step ${step}: ${proposal.id}`).toEqual(observable(fresh));
      }
      // Twelve Monaco plans: about 2s alone, but past the 5s default under a full parallel run.
    },
    30_000,
  );

  it("matches a fresh plan after each kind of decision", () => {
    const plan = planMerge(base, patch, { matching }, quiet);
    const decisions: PlanDecision[] = [];
    // One of each kind, earliest phase last, so each replans from a different phase.
    for (const kind of ["crossing-node", "connect", "exact-merge"] as const) {
      // The last of each kind: in the fixture, rejecting it changes the later phases.
      const proposal = [...plan.proposals.values()].findLast(
        (candidate) => candidate.kind === kind,
      );
      expect(proposal, kind).toBeDefined();
      decisions.push({ proposalId: proposal!.id, action: "reject" });
      setMergePlanDecisions(plan, decisions);
      const fresh = planMerge(base, patch, { matching, decisions }, quiet);
      expect(observable(plan), kind).toEqual(observable(fresh));
    }
  });

  it("replans nothing for a decision that names no proposal", () => {
    const plan = planMerge(base, patch, { matching }, quiet);
    const proposals = plan.proposals;
    setMergePlanDecisions(plan, [{ proposalId: "connect:n1>n2", action: "accept" }]);
    expect(plan.proposals).toBe(proposals);
    expect(plan.staleDecisions).toEqual(["connect:n1>n2"]);
  });
});
