import type {
  OsmChangesetStats,
  OsmConflationGenerationResult,
  OsmConflationOptions,
  OsmConflationSummary,
  OsmMergeOptions,
} from "osmix";

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

/** Add explicit fuzzy conflation without changing the exact-only default object. */
export function completeMergeOptions(conflation?: OsmConflationOptions): Partial<OsmMergeOptions> {
  return conflation ? { ...COMPLETE_MERGE_OPTIONS, conflation } : COMPLETE_MERGE_OPTIONS;
}

/** Build the cumulative direct, exact, and reviewed-fuzzy verified merge options. */
export function verifiedConflationMergeOptions(
  reconcile: boolean,
  conflation: OsmConflationOptions,
): Partial<OsmMergeOptions> {
  return {
    ...verifiedBaseMergeOptions(reconcile),
    conflation,
  };
}

interface ConflationRunAllWorker {
  discoverConflation(
    baseOsmId: string,
    patchOsmId: string,
    options: OsmConflationOptions,
  ): Promise<OsmConflationSummary>;
  generateConflationChangeset(
    baseOsmId: string,
    options: Partial<OsmMergeOptions>,
  ): Promise<OsmConflationGenerationResult>;
  generateChangeset(
    baseOsmId: string,
    patchOsmId: string,
    options: Partial<OsmMergeOptions>,
  ): Promise<OsmChangesetStats>;
  applyChangesAndReplace(osmId: string): Promise<void>;
}

interface RunConflationAllStepsOptions {
  baseOsmId: string;
  conflation: OsmConflationOptions;
  isCancelled: () => boolean;
  onBaseApplied?: () => void;
  onDiscovered?: (summary: OsmConflationSummary) => void;
  onGenerated?: (result: OsmConflationGenerationResult) => void;
  patchOsmId: string;
  worker: ConflationRunAllWorker;
}

export type RunConflationAllStepsResult =
  | {
      generation: OsmConflationGenerationResult | null;
      status: "cancelled";
      summary: OsmConflationSummary;
    }
  | {
      generation: OsmConflationGenerationResult;
      intersections: OsmChangesetStats;
      status: "completed";
      summary: OsmConflationSummary;
    };

/**
 * Run explicit conflation from untouched inputs, then create intersections on the applied result.
 *
 * Cancellation is honored until the first apply. Once the base changes, the intersection stage is
 * completed before returning so callers never expose an incomplete result as a successful merge.
 */
export async function runConflationAllSteps({
  baseOsmId,
  conflation,
  isCancelled,
  onBaseApplied,
  onDiscovered,
  onGenerated,
  patchOsmId,
  worker,
}: RunConflationAllStepsOptions): Promise<RunConflationAllStepsResult> {
  const summary = await worker.discoverConflation(baseOsmId, patchOsmId, conflation);
  onDiscovered?.(summary);
  if (isCancelled()) return { generation: null, status: "cancelled", summary };

  const generation = await worker.generateConflationChangeset(
    baseOsmId,
    verifiedBaseMergeOptions(true),
  );
  onGenerated?.(generation);
  if (isCancelled()) return { generation, status: "cancelled", summary };

  await worker.applyChangesAndReplace(generation.stats.osmId);
  onBaseApplied?.();

  const intersections = await worker.generateChangeset(baseOsmId, patchOsmId, INTERSECTION_OPTIONS);
  await worker.applyChangesAndReplace(intersections.osmId);

  return { generation, intersections, status: "completed", summary };
}

/**
 * Restore any available candidate state, then leave the progress-only screen after a failed run.
 * Showing the review in a `finally` block keeps discovery failures themselves retryable.
 */
export async function recoverConflationRunAllFailure({
  restoreReview,
  showReview,
}: {
  restoreReview?: () => Promise<void>;
  showReview: () => void;
}): Promise<{ error: unknown } | null> {
  let restoreFailure: { error: unknown } | null = null;
  try {
    await restoreReview?.();
  } catch (error) {
    restoreFailure = { error };
  } finally {
    showReview();
  }
  return restoreFailure;
}

export function canApplyChangeset(purpose: ChangesetReviewPurpose): boolean {
  return purpose === "apply";
}

/** Clear the patch overlay before showing the verified merged result. */
export function finalizeVerifiedMerge(clearPatch: () => void, showFinalResult: () => void): void {
  clearPatch();
  showFinalResult();
}
