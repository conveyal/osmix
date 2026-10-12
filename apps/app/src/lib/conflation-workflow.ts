import type { OsmConflationOptions } from "osmix";

export interface ConflationFormState {
  enabled: boolean;
  transferProperties: boolean;
  propertyKeys: string;
  attachNetwork: boolean;
  allowWayRemoval: boolean;
  allowWayReplacement: boolean;
  replacementToleranceMeters: number;
  /** How far an imported path runs along a base path before it is a copy of it (MP-M1). */
  traceLengthMeters: number;
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

/** The planner's default; the option is sent only when the form differs from it. */
const DEFAULT_TRACE_LENGTH_METERS = 10;

export const DEFAULT_CONFLATION_FORM_STATE: ConflationFormState = {
  enabled: false,
  transferProperties: true,
  propertyKeys: DEFAULT_CONFLATION_PROPERTY_KEYS.join(", "),
  attachNetwork: false,
  allowWayRemoval: false,
  allowWayReplacement: false,
  replacementToleranceMeters: 1,
  traceLengthMeters: DEFAULT_TRACE_LENGTH_METERS,
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

const CONFLATION_ERROR_FIELD_IDS = {
  actions: "conflation-property-transfer",
  propertyKeys: "conflation-property-keys",
  maxDistanceMeters: "conflation-distance",
  replacementToleranceMeters: "conflation-replacement-tolerance",
  traceLengthMeters: "conflation-trace-length",
} as const;

export type ConflationFormErrors = Partial<Record<keyof typeof CONFLATION_ERROR_FIELD_IDS, string>>;

/** Keep each configuration problem attached to the control that can resolve it. */
export function conflationFormErrors(state: ConflationFormState): ConflationFormErrors {
  const errors: ConflationFormErrors = {};
  if (!state.enabled) return errors;
  if (!Number.isFinite(state.maxDistanceMeters) || state.maxDistanceMeters <= 0) {
    errors.maxDistanceMeters = "Search radius must be greater than zero.";
  }
  if (
    state.allowWayReplacement &&
    (!Number.isFinite(state.replacementToleranceMeters) || state.replacementToleranceMeters <= 0)
  ) {
    errors.replacementToleranceMeters = "Replacement tolerance must be greater than zero.";
  }
  if (
    state.attachNetwork &&
    (!Number.isFinite(state.traceLengthMeters) || state.traceLengthMeters <= 0)
  ) {
    errors.traceLengthMeters = "Same-path length must be greater than zero.";
  }
  if (
    !state.transferProperties &&
    !state.attachNetwork &&
    !state.allowWayRemoval &&
    !state.allowWayReplacement
  ) {
    errors.actions =
      "Select Copy tags, Connect network, Review redundant way removal, or Replace base ways the import traces.";
  }
  if (state.transferProperties && parseConflationPropertyKeys(state.propertyKeys).length === 0) {
    errors.propertyKeys = "Enter at least one OSM tag key to copy.";
  }
  return errors;
}

/** Return the first configuration problem that must be resolved before discovery. */
export function validateConflationForm(state: ConflationFormState): string | null {
  const errors = conflationFormErrors(state);
  return (
    errors.actions ??
    errors.propertyKeys ??
    errors.maxDistanceMeters ??
    errors.replacementToleranceMeters ??
    errors.traceLengthMeters ??
    null
  );
}

/** Focus the same first problem that blocks discovery when a workflow is started. */
export function firstInvalidConflationInputId(state: ConflationFormState): string | null {
  const errors = conflationFormErrors(state);
  for (const field of [
    "actions",
    "propertyKeys",
    "maxDistanceMeters",
    "replacementToleranceMeters",
    "traceLengthMeters",
  ] as const) {
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
    ...(state.allowWayRemoval ? { allowWayRemoval: true } : {}),
    ...(state.allowWayReplacement
      ? { allowWayReplacement: true, replacementToleranceMeters: state.replacementToleranceMeters }
      : {}),
    ...(state.attachNetwork && state.traceLengthMeters !== DEFAULT_TRACE_LENGTH_METERS
      ? { traceLengthMeters: state.traceLengthMeters }
      : {}),
    maxDistanceMeters: state.maxDistanceMeters,
    automatic: "high-confidence",
  };
}
