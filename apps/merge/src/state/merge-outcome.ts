import { atom } from "jotai";
import type { OsmConflationOutcomeReport } from "osmix";

export interface MergeRunInputs {
  baseName: string;
  patchName: string;
  matchingEnabled: boolean;
}

export interface MergeCompletion {
  inputs: MergeRunInputs;
  outcome: OsmConflationOutcomeReport | null;
}

interface MergeOutcomeState {
  inputs: MergeRunInputs | null;
  generated: OsmConflationOutcomeReport | null;
  applied: OsmConflationOutcomeReport | null;
  hasApplied: boolean;
  hasRefreshed: boolean;
  completion: MergeCompletion | null;
}

const EMPTY_OUTCOME: MergeOutcomeState = {
  inputs: null,
  generated: null,
  applied: null,
  hasApplied: false,
  hasRefreshed: false,
  completion: null,
};

type MergeOutcomeEvent =
  | { type: "begin"; inputs: MergeRunInputs }
  | { type: "generated"; outcome: OsmConflationOutcomeReport | null }
  | { type: "applied" }
  | { type: "result-mutated" }
  | { type: "refreshed" }
  | { type: "complete" }
  | { type: "invalidate-preview" }
  | { type: "reset" };

/** Keep preview evidence separate from successful application and final completion. */
export function reduceMergeOutcome(
  state: MergeOutcomeState,
  event: MergeOutcomeEvent,
): MergeOutcomeState {
  switch (event.type) {
    case "begin":
      return { ...EMPTY_OUTCOME, inputs: { ...event.inputs } };
    case "generated":
      return { ...state, generated: event.outcome };
    case "applied":
      return {
        ...state,
        generated: null,
        applied: state.generated,
        hasApplied: true,
        hasRefreshed: false,
      };
    case "result-mutated":
      return { ...state, hasRefreshed: false, completion: null };
    case "refreshed":
      return { ...state, hasRefreshed: true };
    case "complete":
      if (!state.inputs || !state.hasApplied || !state.hasRefreshed) {
        throw Error("A merge cannot complete before its validated result is applied and refreshed");
      }
      if (state.inputs.matchingEnabled && !state.applied) {
        throw Error("A matching merge cannot complete without its applied outcome report");
      }
      return { ...state, completion: { inputs: state.inputs, outcome: state.applied } };
    case "invalidate-preview":
      return { ...state, generated: null };
    case "reset":
      return { ...EMPTY_OUTCOME };
  }
}

const mergeOutcomeStateAtom = atom<MergeOutcomeState>({ ...EMPTY_OUTCOME });
export const mergeStepIndexAtom = atom(0);
export const mergeCompletionAtom = atom((get) => get(mergeOutcomeStateAtom).completion);
export const generatedMergeOutcomeAtom = atom((get) => get(mergeOutcomeStateAtom).generated);
export const mergeRunInputsAtom = atom((get) => get(mergeOutcomeStateAtom).inputs);
export const pendingMergedRefreshAtom = atom<{
  osmId: string;
  fileName?: string;
  finishOnRetry: boolean;
  synchronize?: boolean;
  error?: string;
} | null>(null);
export const updateMergeOutcomeAtom = atom(null, (get, set, event: MergeOutcomeEvent) => {
  set(mergeOutcomeStateAtom, reduceMergeOutcome(get(mergeOutcomeStateAtom), event));
  if (event.type === "reset") {
    set(mergeStepIndexAtom, 0);
    set(pendingMergedRefreshAtom, null);
  }
});
