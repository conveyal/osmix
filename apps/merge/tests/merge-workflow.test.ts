import { describe, expect, it } from "vitest";

import {
  canApplyChangeset,
  COMPLETE_MERGE_OPTIONS,
  CROSS_DATASET_RECONCILIATION_OPTIONS,
  finalizeVerifiedMerge,
  INTERSECTION_OPTIONS,
  verifiedBaseMergeOptions,
  WITHIN_DATASET_DIAGNOSTIC_OPTIONS,
} from "../src/lib/merge-workflow";

describe("merge workflow policy", () => {
  it("keeps within-dataset duplicate scans diagnostic", () => {
    expect(WITHIN_DATASET_DIAGNOSTIC_OPTIONS).toEqual({
      deduplicateNodes: true,
      deduplicateWays: true,
    });
    expect(canApplyChangeset("diagnostic")).toBe(false);
    expect(canApplyChangeset("preview")).toBe(false);
  });

  it("uses the same cross-dataset reconciliation options in a complete merge", () => {
    expect(COMPLETE_MERGE_OPTIONS).toMatchObject(CROSS_DATASET_RECONCILIATION_OPTIONS);
    expect(COMPLETE_MERGE_OPTIONS).toEqual({
      deduplicateNodes: true,
      deduplicateWays: true,
      directMerge: true,
      createIntersections: true,
    });
    expect(canApplyChangeset("apply")).toBe(true);
  });

  it("regenerates the verified base merge from the original inputs", () => {
    expect(verifiedBaseMergeOptions(false)).toEqual({
      directMerge: true,
    });
    expect(verifiedBaseMergeOptions(true)).toEqual({
      directMerge: true,
      deduplicateNodes: true,
      deduplicateWays: true,
    });
    expect(INTERSECTION_OPTIONS).toEqual({ createIntersections: true });
  });

  it("clears the patch before verified final inspection", () => {
    const transitions: string[] = [];

    finalizeVerifiedMerge(
      () => transitions.push("clear-patch"),
      () => transitions.push("show-final"),
    );

    expect(transitions).toEqual(["clear-patch", "show-final"]);
  });
});
