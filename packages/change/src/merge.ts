/**
 * High-level merge: plan and apply in one call.
 *
 * @module
 */

import type { Osm } from "@osmix/core";
import { logProgress, type ProgressEvent, progressEvent } from "@osmix/shared/progress";

import { applyPlan, planMerge } from "./plan/plan.ts";
import type { MergePlanOptions } from "./plan/types.ts";
import { changeStatsSummary } from "./utils.ts";

/**
 * Merge `patch` into `base` in one call: plan the merge and apply the plan, with no review.
 *
 * Uses the Merge app's defaults unless `options` says otherwise: imported points at identical
 * coordinates merge into the base, imported ways connect where they cross, and matching runs
 * only when configured. Proposals that need a decision are left out unless `options.decisions`
 * accepts them. To review first, use `planMerge` and `applyPlan`.
 *
 * @param base - The base OSM dataset to merge into. Unchanged.
 * @param patch - The OSM dataset to merge from. Unchanged.
 * @param options - Plan options; see `MergePlanOptions`.
 * @param onProgress - Callback for progress updates during the merge.
 * @returns The merged OSM dataset.
 * @throws When the merge would introduce routing-integrity problems.
 *
 * @example
 * ```ts
 * const merged = await merge(baseOsm, patchOsm)
 * const matched = await merge(baseOsm, patchOsm, {
 *   matching: { propertyKeys: ["surface"], attachNetwork: true },
 * })
 * ```
 */
export async function merge(
  base: Osm,
  patch: Osm,
  options: MergePlanOptions = {},
  onProgress: (progress: ProgressEvent) => void = logProgress,
): Promise<Osm> {
  const { osm, stats } = applyPlan(planMerge(base, patch, options, onProgress));
  onProgress(progressEvent(changeStatsSummary(stats)));
  return osm;
}
