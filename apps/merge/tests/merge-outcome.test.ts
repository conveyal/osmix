import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import {
  mergeCompletionAtom,
  mergeRunInputsAtom,
  mergeStepIndexAtom,
  pendingMergedRefreshAtom,
  updateMergeOutcomeAtom,
} from "../src/state/merge-outcome";
import { emptyMatchingOutcome } from "./fixtures/merge-outcome";

const inputs = { baseName: "base.pbf", patchName: "import.pbf", matchingEnabled: true };

describe("merge completion evidence", () => {
  it("does not describe missing matching evidence as an exact-only success", () => {
    const store = createStore();
    store.set(updateMergeOutcomeAtom, { type: "begin", inputs });
    store.set(updateMergeOutcomeAtom, { type: "applied" });
    store.set(updateMergeOutcomeAtom, { type: "refreshed" });
    expect(() => store.set(updateMergeOutcomeAtom, { type: "complete" })).toThrow(
      "applied outcome report",
    );
    expect(store.get(mergeCompletionAtom)).toBeNull();
  });

  it("requires successful application and refresh, even when generation succeeded", () => {
    const store = createStore();
    store.set(updateMergeOutcomeAtom, { type: "begin", inputs });
    store.set(updateMergeOutcomeAtom, { type: "generated", outcome: emptyMatchingOutcome() });
    expect(() => store.set(updateMergeOutcomeAtom, { type: "complete" })).toThrow(
      "applied and refreshed",
    );
    expect(store.get(mergeCompletionAtom)).toBeNull();
    store.set(updateMergeOutcomeAtom, { type: "applied" });
    expect(() => store.set(updateMergeOutcomeAtom, { type: "complete" })).toThrow(
      "applied and refreshed",
    );
    expect(store.get(mergeCompletionAtom)).toBeNull();
    store.set(updateMergeOutcomeAtom, { type: "refreshed" });
    store.set(updateMergeOutcomeAtom, { type: "complete" });
    expect(store.get(mergeCompletionAtom)).toEqual({ inputs, outcome: emptyMatchingOutcome() });
  });

  it("retains the applied report after live preview invalidation and later intersections", () => {
    const store = createStore();
    const outcome = emptyMatchingOutcome();
    outcome.summary.unmatchedFeatures =
      outcome.summary.unresolvedFeatures =
      outcome.summary.features =
        1;
    store.set(updateMergeOutcomeAtom, { type: "begin", inputs });
    store.set(updateMergeOutcomeAtom, { type: "generated", outcome });
    store.set(updateMergeOutcomeAtom, { type: "applied" });
    store.set(updateMergeOutcomeAtom, { type: "refreshed" });
    store.set(updateMergeOutcomeAtom, { type: "invalidate-preview" });
    store.set(updateMergeOutcomeAtom, { type: "result-mutated" });
    expect(() => store.set(updateMergeOutcomeAtom, { type: "complete" })).toThrow(
      "applied and refreshed",
    );
    store.set(updateMergeOutcomeAtom, { type: "refreshed" });
    store.set(updateMergeOutcomeAtom, { type: "complete" });
    expect(store.get(mergeCompletionAtom)).toEqual({ inputs, outcome });
  });

  it("keeps a successful no-op report and replaces it when decisions are regenerated", () => {
    const store = createStore();
    store.set(updateMergeOutcomeAtom, { type: "begin", inputs });
    const previous = emptyMatchingOutcome();
    previous.summary.unresolvedFeatures = previous.summary.features = 1;
    store.set(updateMergeOutcomeAtom, { type: "generated", outcome: previous });
    store.set(updateMergeOutcomeAtom, { type: "invalidate-preview" });
    const regenerated = emptyMatchingOutcome();
    store.set(updateMergeOutcomeAtom, { type: "generated", outcome: regenerated });
    store.set(updateMergeOutcomeAtom, { type: "applied" });
    store.set(updateMergeOutcomeAtom, { type: "refreshed" });
    store.set(updateMergeOutcomeAtom, { type: "complete" });
    expect(store.get(mergeCompletionAtom)?.outcome).toEqual(regenerated);
  });

  it("clears prior completion on replacement and supports an exact-only run", () => {
    const store = createStore();
    store.set(updateMergeOutcomeAtom, { type: "begin", inputs });
    store.set(updateMergeOutcomeAtom, { type: "generated", outcome: emptyMatchingOutcome() });
    store.set(updateMergeOutcomeAtom, { type: "applied" });
    store.set(updateMergeOutcomeAtom, { type: "refreshed" });
    store.set(updateMergeOutcomeAtom, { type: "complete" });
    store.set(mergeStepIndexAtom, 12);
    store.set(pendingMergedRefreshAtom, { osmId: "old-result", finishOnRetry: true });
    store.set(updateMergeOutcomeAtom, { type: "reset" });
    expect(store.get(mergeCompletionAtom)).toBeNull();
    expect(store.get(mergeRunInputsAtom)).toBeNull();
    expect(store.get(mergeStepIndexAtom)).toBe(0);
    expect(store.get(pendingMergedRefreshAtom)).toBeNull();
    const nextInputs = { ...inputs, baseName: "original.pbf", matchingEnabled: false };
    store.set(updateMergeOutcomeAtom, { type: "begin", inputs: nextInputs });
    expect(() => store.set(updateMergeOutcomeAtom, { type: "complete" })).toThrow();
    store.set(updateMergeOutcomeAtom, { type: "applied" });
    store.set(updateMergeOutcomeAtom, { type: "refreshed" });
    store.set(updateMergeOutcomeAtom, { type: "complete" });
    expect(store.get(mergeCompletionAtom)).toEqual({ inputs: nextInputs, outcome: null });
  });
});
