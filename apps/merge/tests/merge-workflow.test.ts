import type { OsmChangesetStats, OsmConflationGenerationResult, OsmConflationSummary } from "osmix";
import { describe, expect, it, vi } from "vitest";

import {
  canApplyChangeset,
  COMPLETE_MERGE_OPTIONS,
  completeMergeOptions,
  CROSS_DATASET_RECONCILIATION_OPTIONS,
  finalizeVerifiedMerge,
  INTERSECTION_OPTIONS,
  recoverConflationRunAllFailure,
  runConflationAllSteps,
  verifiedConflationMergeOptions,
  verifiedBaseMergeOptions,
  WITHIN_DATASET_DIAGNOSTIC_OPTIONS,
} from "../src/lib/merge-workflow";

const changesetStats = (osmId: string, totalChanges: number): OsmChangesetStats => ({
  deduplicatedNodes: 0,
  deduplicatedNodesReplaced: 0,
  deduplicatedWays: 0,
  intersectionNodesCreated: 0,
  intersectionPointsFound: 0,
  nodeChanges: totalChanges,
  osmId,
  relationChanges: 0,
  totalChanges,
  wayChanges: 0,
});

const summary: OsmConflationSummary = {
  accepted: 0,
  automatic: 1,
  blocked: 0,
  rejected: 0,
  review: 1,
  total: 3,
  unmatched: 1,
};

const generation: OsmConflationGenerationResult = {
  stats: changesetStats("base", 3),
  routing: {
    car: {
      before: { components: 1, edges: 2, nodes: 2, routableNodes: 2 },
      after: { components: 1, edges: 2, nodes: 2, routableNodes: 2 },
      delta: { components: 0, edges: 0, nodes: 0, routableNodes: 0 },
    },
    walk: {
      before: { components: 2, edges: 2, nodes: 3, routableNodes: 3 },
      after: { components: 1, edges: 4, nodes: 4, routableNodes: 4 },
      delta: { components: -1, edges: 2, nodes: 1, routableNodes: 1 },
    },
  },
};

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

  it("keeps exact-only defaults while adding explicitly configured conflation", () => {
    const conflation = {
      propertyKeys: ["name"],
      attachNetwork: false,
      maxDistanceMeters: 1,
      automatic: "high-confidence" as const,
    };

    expect(completeMergeOptions()).toBe(COMPLETE_MERGE_OPTIONS);
    expect(completeMergeOptions(conflation)).toEqual({
      ...COMPLETE_MERGE_OPTIONS,
      conflation,
    });
    expect(verifiedConflationMergeOptions(true, conflation)).toEqual({
      directMerge: true,
      deduplicateNodes: true,
      deduplicateWays: true,
      conflation,
    });
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

  it("runs enabled run-all through session generation before intersections", async () => {
    const calls: string[] = [];
    const intersections = changesetStats("base", 2);
    const conflation = {
      propertyKeys: ["name"],
      attachNetwork: true,
      maxDistanceMeters: 1,
      automatic: "high-confidence" as const,
    };
    const worker = {
      discoverConflation: vi.fn(async () => {
        calls.push("discover");
        return summary;
      }),
      generateConflationChangeset: vi.fn(async () => {
        calls.push("generate-conflation");
        return generation;
      }),
      applyChangesAndReplace: vi.fn(async () => {
        calls.push("apply");
      }),
      generateChangeset: vi.fn(async () => {
        calls.push("generate-intersections");
        return intersections;
      }),
    };

    const result = await runConflationAllSteps({
      baseOsmId: "base",
      conflation,
      isCancelled: () => false,
      patchOsmId: "patch",
      worker,
    });

    expect(result).toEqual({
      generation,
      intersections,
      status: "completed",
      summary,
    });
    expect(calls).toEqual([
      "discover",
      "generate-conflation",
      "apply",
      "generate-intersections",
      "apply",
    ]);
    expect(worker.discoverConflation).toHaveBeenCalledWith("base", "patch", conflation);
    expect(worker.generateConflationChangeset).toHaveBeenCalledWith(
      "base",
      verifiedBaseMergeOptions(true),
    );
    expect(worker.generateChangeset).toHaveBeenCalledWith("base", "patch", INTERSECTION_OPTIONS);
    expect(worker.applyChangesAndReplace).toHaveBeenNthCalledWith(1, "base");
    expect(worker.applyChangesAndReplace).toHaveBeenNthCalledWith(2, "base");
  });

  it("cancels enabled run-all before mutating either input", async () => {
    const worker = {
      discoverConflation: vi.fn(async () => summary),
      generateConflationChangeset: vi.fn(async () => generation),
      applyChangesAndReplace: vi.fn(async () => {}),
      generateChangeset: vi.fn(async () => changesetStats("base", 0)),
    };

    const result = await runConflationAllSteps({
      baseOsmId: "base",
      conflation: {
        propertyKeys: ["name"],
        attachNetwork: false,
        automatic: "high-confidence",
      },
      isCancelled: () => true,
      patchOsmId: "patch",
      worker,
    });

    expect(result).toEqual({ generation: null, status: "cancelled", summary });
    expect(worker.generateConflationChangeset).not.toHaveBeenCalled();
    expect(worker.applyChangesAndReplace).not.toHaveBeenCalled();
    expect(worker.generateChangeset).not.toHaveBeenCalled();
  });

  it("returns failed conflation run-all work to a retryable review screen", async () => {
    const transitions: string[] = [];

    const restoreError = await recoverConflationRunAllFailure({
      restoreReview: async () => {
        transitions.push("restore-candidate-session");
      },
      showReview: () => transitions.push("show-match-imported-data"),
    });

    expect(restoreError).toBeNull();
    expect(transitions).toEqual(["restore-candidate-session", "show-match-imported-data"]);

    transitions.length = 0;
    const discoveryFailure = await recoverConflationRunAllFailure({
      restoreReview: async () => {
        transitions.push("restore-failed");
        throw Error("candidate discovery did not create a session");
      },
      showReview: () => transitions.push("show-match-imported-data"),
    });

    expect(discoveryFailure).toEqual({
      error: Error("candidate discovery did not create a session"),
    });
    expect(transitions).toEqual(["restore-failed", "show-match-imported-data"]);

    transitions.length = 0;
    await recoverConflationRunAllFailure({
      showReview: () => transitions.push("show-match-imported-data"),
    });
    expect(transitions).toEqual(["show-match-imported-data"]);
  });
});
