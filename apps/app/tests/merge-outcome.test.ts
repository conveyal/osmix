import { createStore } from "jotai";
import type { MergePlanOverview } from "osmix";
import { describe, expect, it } from "vitest";

import {
  mergeCompletionAtom,
  mergeStepAtom,
  pendingMergedRefreshAtom,
  updateMergeOutcomeAtom,
} from "../src/state/merge-outcome";

const inputs = { baseName: "base.pbf", patchName: "import.pbf", matchingEnabled: false };
const plan = { featureCount: 3 } as MergePlanOverview;

describe("merge outcome", () => {
  it("completes only after the plan is applied and the result refreshed", () => {
    const store = createStore();
    store.set(updateMergeOutcomeAtom, { type: "begin", inputs });
    expect(() => store.set(updateMergeOutcomeAtom, { type: "applied" })).toThrow(
      "before it is planned",
    );
    store.set(updateMergeOutcomeAtom, { type: "planned", plan });
    expect(() => store.set(updateMergeOutcomeAtom, { type: "complete" })).toThrow(
      "applied and refreshed",
    );
    store.set(updateMergeOutcomeAtom, { type: "applied" });
    expect(() => store.set(updateMergeOutcomeAtom, { type: "complete" })).toThrow(
      "applied and refreshed",
    );
    store.set(updateMergeOutcomeAtom, { type: "refreshed" });
    store.set(updateMergeOutcomeAtom, { type: "complete" });
    expect(store.get(mergeCompletionAtom)).toEqual({ inputs, plan });
  });

  it("refuses to replan an applied merge", () => {
    const store = createStore();
    store.set(updateMergeOutcomeAtom, { type: "begin", inputs });
    store.set(updateMergeOutcomeAtom, { type: "planned", plan });
    store.set(updateMergeOutcomeAtom, { type: "applied" });
    expect(() => store.set(updateMergeOutcomeAtom, { type: "planned", plan })).toThrow(
      "cannot be planned again",
    );
  });

  it("returns to the inputs and forgets a pending refresh on reset", () => {
    const store = createStore();
    store.set(mergeStepAtom, "result");
    store.set(pendingMergedRefreshAtom, { osmId: "base" });
    store.set(updateMergeOutcomeAtom, { type: "reset" });
    expect(store.get(mergeStepAtom)).toBe("inputs");
    expect(store.get(pendingMergedRefreshAtom)).toBeNull();
    expect(store.get(mergeCompletionAtom)).toBeNull();
  });
});
