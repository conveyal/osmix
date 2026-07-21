import type { OsmMergeOptions } from "osmix";

export type ChangesetReviewPurpose = "apply" | "diagnostic" | "preview";

/**
 * A same-dataset comparison may surface suspicious entities for review, but its
 * proposed edits must never be applied automatically.
 */
export const WITHIN_DATASET_DIAGNOSTIC_OPTIONS = {
  deduplicateNodes: true,
  deduplicateWays: true,
} as const satisfies Partial<OsmMergeOptions>;

/** Reconcile entities from the patch against the base without normalizing either input. */
export const CROSS_DATASET_RECONCILIATION_OPTIONS = {
  deduplicateNodes: true,
  deduplicateWays: true,
} as const satisfies Partial<OsmMergeOptions>;

export const DIRECT_MERGE_OPTIONS = {
  directMerge: true,
} as const satisfies Partial<OsmMergeOptions>;

/** Build a verified base merge from the untouched base and patch. */
export function verifiedBaseMergeOptions(reconcile: boolean): Partial<OsmMergeOptions> {
  return {
    ...DIRECT_MERGE_OPTIONS,
    ...(reconcile ? CROSS_DATASET_RECONCILIATION_OPTIONS : {}),
  };
}

export const INTERSECTION_OPTIONS = {
  createIntersections: true,
} as const satisfies Partial<OsmMergeOptions>;

/** Options shared by the non-interactive, high-level merge workflow. */
export const COMPLETE_MERGE_OPTIONS = {
  ...verifiedBaseMergeOptions(true),
  ...INTERSECTION_OPTIONS,
} as const satisfies Partial<OsmMergeOptions>;

export function canApplyChangeset(purpose: ChangesetReviewPurpose): boolean {
  return purpose === "apply";
}

/** Clear the patch overlay before showing the verified merged result. */
export function finalizeVerifiedMerge(clearPatch: () => void, showFinalResult: () => void): void {
  clearPatch();
  showFinalResult();
}
