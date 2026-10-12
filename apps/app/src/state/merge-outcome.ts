import { atom } from "jotai";
import type { MergePlanOverview } from "osmix";

interface MergeRunInputs {
  baseName: string;
  patchName: string;
  matchingEnabled: boolean;
}

/** What a finished merge did: its inputs and the plan it applied. */
export interface MergeCompletion {
  inputs: MergeRunInputs;
  plan: MergePlanOverview;
}

interface MergeOutcomeState {
  inputs: MergeRunInputs | null;
  plan: MergePlanOverview | null;
  hasApplied: boolean;
  hasRefreshed: boolean;
  completion: MergeCompletion | null;
}

const EMPTY_OUTCOME: MergeOutcomeState = {
  inputs: null,
  plan: null,
  hasApplied: false,
  hasRefreshed: false,
  completion: null,
};

export type MergeOutcomeEvent =
  | { type: "begin"; inputs: MergeRunInputs }
  | { type: "planned"; plan: MergePlanOverview }
  | { type: "applied" }
  | { type: "refreshed" }
  | { type: "complete" }
  | { type: "reset" };

/**
 * begin → planned → applied → refreshed → complete. A merge completes only after its plan was
 * applied and the result shown is the applied one; replanning after applying is refused.
 */
function reduceMergeOutcome(state: MergeOutcomeState, event: MergeOutcomeEvent): MergeOutcomeState {
  switch (event.type) {
    case "begin":
      return { ...EMPTY_OUTCOME, inputs: { ...event.inputs } };
    case "planned":
      if (state.hasApplied) throw Error("An applied merge cannot be planned again");
      return { ...state, plan: event.plan };
    case "applied":
      if (!state.plan) throw Error("A merge cannot be applied before it is planned");
      return { ...state, hasApplied: true, hasRefreshed: false };
    case "refreshed":
      return { ...state, hasRefreshed: true };
    case "complete":
      if (!state.inputs || !state.plan || !state.hasApplied || !state.hasRefreshed) {
        throw Error("A merge cannot complete before its plan is applied and refreshed");
      }
      return { ...state, completion: { inputs: state.inputs, plan: state.plan } };
    case "reset":
      return { ...EMPTY_OUTCOME };
  }
}

export type MergeStepId = "inputs" | "review" | "automatic" | "result";

const mergeOutcomeStateAtom = atom<MergeOutcomeState>({ ...EMPTY_OUTCOME });
export const mergeStepAtom = atom<MergeStepId>("inputs");
export const mergeCompletionAtom = atom((get) => get(mergeOutcomeStateAtom).completion);
export const mergeRunInputsAtom = atom((get) => get(mergeOutcomeStateAtom).inputs);
export const pendingMergedRefreshAtom = atom<{
  osmId: string;
  fileName?: string;
  synchronize?: boolean;
  error?: string;
} | null>(null);
export const updateMergeOutcomeAtom = atom(null, (get, set, event: MergeOutcomeEvent) => {
  set(mergeOutcomeStateAtom, reduceMergeOutcome(get(mergeOutcomeStateAtom), event));
  if (event.type === "reset") {
    set(mergeStepAtom, "inputs");
    set(pendingMergedRefreshAtom, null);
  }
});
