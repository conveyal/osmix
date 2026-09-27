import type { Osm } from "@osmix/core";
import { expect } from "vitest";

import { applyPlan, planMerge } from "../../src/plan/plan.ts";
import type { MergePlan, MergePlanOptions, PlanProposal } from "../../src/plan/types.ts";

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
