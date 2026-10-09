import type { Osm } from "@osmix/core";
import { expect } from "vitest";

import { applyPlan, planMerge } from "../../src/plan/plan.ts";
import type {
  MergePlan,
  MergePlanOptions,
  PlanDecision,
  PlanProposal,
} from "../../src/plan/types.ts";
import type { OsmConflationDecision } from "../../src/types.ts";

/** Plan quietly and apply, returning both. */
export function planAndApply(base: Osm, patch: Osm, options: MergePlanOptions = {}) {
  const plan = planMerge(base, patch, options, () => {});
  return { plan, ...applyPlan(plan) };
}

/** The proposal with `id`; fails the test when the plan does not have it. */
export function findProposal(plan: MergePlan, id: string): PlanProposal {
  const proposal = plan.proposals.get(id);
  expect(proposal, `proposal ${id} in ${[...plan.proposals.keys()].join(", ")}`).toBeDefined();
  return proposal!;
}

/**
 * Plan options with matching decisions written as candidate decisions, the form the matching
 * tests describe. Each becomes a decision on the proposals of its candidate.
 */
export function withMatchingDecisions(
  base: Osm,
  patch: Osm,
  options: MergePlanOptions,
  decisions: readonly OsmConflationDecision[],
): MergePlanOptions {
  if (decisions.length === 0) return options;
  const plan = planMerge(base, patch, options, () => {});
  const byCandidate = new Map(decisions.map((decision) => [decision.candidateId, decision]));
  const known = new Set<string>();
  const result: PlanDecision[] = [];
  for (const proposal of plan.proposals.values()) {
    if (!("candidateId" in proposal)) continue;
    known.add(proposal.candidateId);
    const decision = byCandidate.get(proposal.candidateId);
    if (!decision) continue;
    const selected =
      decision.action === "accept" &&
      (proposal.kind === "connect"
        ? (decision.attachNetwork ?? true)
        : proposal.kind === "copy-tags"
          ? (decision.transferProperties ?? true)
          : decision.removeWay === true);
    if (proposal.kind === "remove-way" && !selected) continue;
    result.push({ proposalId: proposal.id, action: selected ? "accept" : "reject" });
  }
  for (const id of byCandidate.keys()) {
    if (!known.has(id)) throw Error(`Unknown conflation candidate: ${id}`);
  }
  return { ...options, decisions: result };
}
