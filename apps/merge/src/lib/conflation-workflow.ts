import type {
  OsmConflationCandidateView,
  OsmConflationDecision,
  OsmConflationOptions,
} from "osmix";

export interface ConflationFormState {
  enabled: boolean;
  transferProperties: boolean;
  propertyKeys: string;
  attachNetwork: boolean;
  maxDistanceMeters: number;
}

export const DEFAULT_CONFLATION_FORM_STATE: ConflationFormState = {
  enabled: false,
  transferProperties: true,
  propertyKeys: "",
  attachNetwork: false,
  maxDistanceMeters: 1,
};

/** Parse a comma- or whitespace-separated tag-key field into stable unique keys. */
export function parseConflationPropertyKeys(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ].sort();
}

/** Return the first configuration problem that must be resolved before discovery. */
export function validateConflationForm(state: ConflationFormState): string | null {
  if (!state.enabled) return null;
  if (!Number.isFinite(state.maxDistanceMeters) || state.maxDistanceMeters <= 0) {
    return "Match distance must be greater than zero.";
  }
  if (!state.transferProperties && !state.attachNetwork) {
    return "Enable property transfer, network attachment, or both.";
  }
  if (state.transferProperties && parseConflationPropertyKeys(state.propertyKeys).length === 0) {
    return "Enter at least one property key to transfer.";
  }
  return null;
}

/** Convert the opt-in form into deterministic worker options. */
export function toOsmConflationOptions(
  state: ConflationFormState,
): OsmConflationOptions | undefined {
  if (!state.enabled) return undefined;
  const validationMessage = validateConflationForm(state);
  if (validationMessage) throw new Error(validationMessage);
  return {
    propertyKeys: state.transferProperties ? parseConflationPropertyKeys(state.propertyKeys) : [],
    attachNetwork: state.attachNetwork,
    maxDistanceMeters: state.maxDistanceMeters,
    automatic: "high-confidence",
  };
}

/** Build the safe bulk-review decision for an automatic, non-routing property-only match. */
export function toAutomaticPropertyOnlyDecision(
  candidate: OsmConflationCandidateView,
): OsmConflationDecision | null {
  if (candidate.decision !== undefined) return null;
  if (candidate.propertyTransfer.status !== "automatic") return null;
  if (candidate.networkAttachment?.status === "automatic") return null;
  if (candidate.evidence.tagDiff.length === 0) return null;
  if (candidate.evidence.tagDiff.some((diff) => diff.routing || diff.protected)) return null;
  return {
    candidateId: candidate.id,
    action: "accept",
    transferProperties: true,
    attachNetwork: false,
  };
}
