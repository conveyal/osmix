/**
 * @osmix/change - Plan and apply merges of OpenStreetMap datasets.
 *
 * A merge is planned once: every change is a proposal grouped by imported feature, decided,
 * then applied in a single build and validated for routing integrity.
 *
 * Key capabilities:
 * - **Plans**: `planMerge`, `setMergePlanDecisions`, `applyPlan`, `generateMergePlanOsc`.
 * - **One call**: `merge` plans and applies with the Merge app's defaults.
 * - **Matching**: `discoverConflationCandidates` finds nearby base features for imported ones.
 * - **Within one dataset**: `planWithinDatasetDeduplication` finds duplicates to remove.
 *
 * @example
 * ```ts
 * import { applyPlan, merge, planMerge, setMergePlanDecisions } from "@osmix/change"
 *
 * const merged = await merge(baseOsm, patchOsm)
 *
 * const plan = planMerge(baseOsm, patchOsm, { mergeIdenticalPoints: false })
 * setMergePlanDecisions(plan, [{ proposalId: "exact:n-1>n1", action: "accept" }])
 * const { osm } = applyPlan(plan)
 * ```
 *
 * @module @osmix/change
 */

export * from "./apply-changeset.ts";
export * from "./changeset.ts";
export { discoverConflationCandidates } from "./conflation.ts";
export * from "./merge.ts";
export * from "./osc.ts";
export {
  applyPlan,
  generateMergePlanOsc,
  getMergePlanCandidate,
  type MergePlanHooks,
  type MergePlanResult,
  planMerge,
  setMergePlanDecisions,
} from "./plan/plan.ts";
export { planWithinDatasetDeduplication } from "./plan/deduplication.ts";
export { MergePlanDecisionConflictError } from "./plan/decision-conflict.ts";
export * from "./plan/types.ts";
export * from "./types.ts";
export * from "./utils.ts";
