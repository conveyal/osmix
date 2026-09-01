import type { OsmConflationBulkAction, OsmConflationOptions } from "osmix";

export interface ConflationFormState {
  enabled: boolean;
  transferProperties: boolean;
  propertyKeys: string;
  attachNetwork: boolean;
  maxDistanceMeters: number;
}

// These node-level accessibility tags produced useful Yakima matches without the
// thousands of unmatched way candidates introduced by broad surface/geometry keys.
export const DEFAULT_CONFLATION_PROPERTY_KEYS = [
  "barrier",
  "crossing",
  "kerb",
  "tactile_paving",
] as const;

export const DEFAULT_CONFLATION_FORM_STATE: ConflationFormState = {
  enabled: false,
  transferProperties: true,
  propertyKeys: DEFAULT_CONFLATION_PROPERTY_KEYS.join(", "),
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

export interface ConflationBulkActionCopy {
  buttonLabel: string;
  confirmLabel: string;
  description: string;
  title: string;
}

/** Keep filter-wide action wording consistent between the toolbar and confirmation dialog. */
export function conflationBulkActionCopy(
  action: OsmConflationBulkAction,
): ConflationBulkActionCopy {
  if (action === "transfer-properties") {
    return {
      buttonLabel: "Transfer properties",
      confirmLabel: "Transfer properties",
      description:
        "Transfer the selected patch properties to every eligible base match in the current filters.",
      title: "Transfer properties to filtered matches?",
    };
  }
  if (action === "attach-network") {
    return {
      buttonLabel: "Attach network",
      confirmLabel: "Attach network",
      description:
        "Attach imported way references to every eligible base match in the current filters.",
      title: "Attach the filtered imported network?",
    };
  }
  return {
    buttonLabel: "Reject filtered",
    confirmLabel: "Reject filtered matches",
    description:
      "Reject every filtered match that is not already rejected, including blocked and unmatched rows.",
    title: "Reject all filtered matches?",
  };
}
