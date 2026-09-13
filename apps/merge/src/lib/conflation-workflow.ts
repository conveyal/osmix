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

export const CONFLATION_ERROR_FIELD_IDS = {
  actions: "conflation-property-transfer",
  propertyKeys: "conflation-property-keys",
  maxDistanceMeters: "conflation-distance",
} as const;

export type ConflationFormErrors = Partial<Record<keyof typeof CONFLATION_ERROR_FIELD_IDS, string>>;

/** Keep each configuration problem attached to the control that can resolve it. */
export function conflationFormErrors(state: ConflationFormState): ConflationFormErrors {
  const errors: ConflationFormErrors = {};
  if (!state.enabled) return errors;
  if (!Number.isFinite(state.maxDistanceMeters) || state.maxDistanceMeters <= 0) {
    errors.maxDistanceMeters = "Match distance must be greater than zero.";
  }
  if (!state.transferProperties && !state.attachNetwork) {
    errors.actions = "Select Copy tags, Connect network, or both.";
  }
  if (state.transferProperties && parseConflationPropertyKeys(state.propertyKeys).length === 0) {
    errors.propertyKeys = "Enter at least one OSM tag key to copy.";
  }
  return errors;
}

/** Return the first configuration problem that must be resolved before discovery. */
export function validateConflationForm(state: ConflationFormState): string | null {
  const errors = conflationFormErrors(state);
  return errors.actions ?? errors.propertyKeys ?? errors.maxDistanceMeters ?? null;
}

/** Focus the same first problem that blocks discovery when a workflow is started. */
export function firstInvalidConflationInputId(state: ConflationFormState): string | null {
  const errors = conflationFormErrors(state);
  for (const field of ["actions", "propertyKeys", "maxDistanceMeters"] as const) {
    if (errors[field]) return CONFLATION_ERROR_FIELD_IDS[field];
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
      buttonLabel: "Copy tags",
      confirmLabel: "Copy tags",
      description:
        "Schedule copying selected imported attributes to every eligible base match in the current filters. Keep each network connection choice unchanged.",
      title: "Copy tags for filtered matches?",
    };
  }
  if (action === "attach-network") {
    return {
      buttonLabel: "Connect network",
      confirmLabel: "Connect network",
      description:
        "Schedule connecting imported ways to every eligible base match in the current filters. Keep each tag-copying choice unchanged.",
      title: "Connect the filtered imported network?",
    };
  }
  return {
    buttonLabel: "Skip filtered",
    confirmLabel: "Skip filtered matches",
    description:
      "Schedule no matching actions for the filtered matches. Keep ordinary imported additions, including blocked and unmatched features.",
    title: "Skip all filtered matches?",
  };
}
