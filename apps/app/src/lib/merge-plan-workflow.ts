import type {
  MergePlanAutomation,
  MergePlanBulkCounts,
  MergePlanBulkRequest,
  MergePlanOptions,
  OsmConflationOptions,
  PatchIdMode,
  PlanChoiceGroup,
  PlanDecision,
  PlanFeature,
  PlanOutcome,
  PlanProposal,
  PlanProposalEffect,
  PlanProposalStatus,
} from "osmix";

/** Plan options from the input step's settings. */
export function buildMergePlanOptions({
  automation,
  matching,
  mergeIdenticalPoints,
  patchIds,
}: {
  automation: MergePlanAutomation;
  matching?: OsmConflationOptions;
  mergeIdenticalPoints: boolean;
  patchIds: PatchIdMode;
}): MergePlanOptions {
  return {
    automation,
    mergeIdenticalPoints,
    patchIds,
    ...(matching ? { matching: { ...matching, propertyKeys: [...matching.propertyKeys] } } : {}),
  };
}

/** Outcomes in the order the review lists them. */
export const OUTCOMES: readonly PlanOutcome[] = [
  "needs-decision",
  "removed",
  "replaced",
  "merged",
  "connected",
  "added",
  "unchanged",
];

export const OUTCOME_LABEL: Record<PlanOutcome, string> = {
  "needs-decision": "Needs decision",
  removed: "Removed",
  merged: "Merged",
  connected: "Connected",
  replaced: "Replaced",
  added: "Added",
  unchanged: "Unchanged",
};

export const OUTCOME_HELP: Record<PlanOutcome, string> = {
  "needs-decision": "A proposal waits for your choice; until then it is left out",
  removed: "The imported way is removed in favor of its base counterpart",
  merged: "Joins a base feature, or copies tags onto one",
  connected: "Shares a node with the base network",
  replaced:
    "Its positive ID edits a base entity with the same ID, or it is kept in place of base ways " +
    "it traces",
  added: "Added as a new feature",
  unchanged: "Identical to the base entity with the same ID",
};

export const PROPOSAL_KIND_LABEL: Record<PlanProposal["kind"], string> = {
  add: "Add new feature",
  "same-id-replace": "Replace base entity with the same ID",
  "exact-merge": "Merge point at identical coordinates",
  "way-reconcile": "Merge identical way",
  connect: "Connect network",
  "copy-tags": "Copy tags",
  "remove-way": "Remove imported way",
  "replace-way": "Replace base way",
  "crossing-snap": "Connect at crossing vertex",
  "crossing-node": "Add crossing node",
};

export const PROPOSAL_STATUS_LABEL: Record<PlanProposalStatus, string> = {
  automatic: "Automatic",
  review: "Needs review",
  blocked: "Blocked",
};

export const PROPOSAL_EFFECT_LABEL: Record<PlanProposalEffect, string> = {
  applied: "In the plan",
  skipped: "Left out",
  blocked: "Blocked",
  "needs-decision": "Waiting for a decision",
};

/** Proposal kinds a review filter can pick, in pipeline order. */
export const FILTERABLE_KINDS: readonly PlanProposal["kind"][] = [
  "same-id-replace",
  "exact-merge",
  "way-reconcile",
  "connect",
  "copy-tags",
  "remove-way",
  "replace-way",
  "crossing-snap",
  "crossing-node",
];

const REASON_LABEL: Record<string, string> = {
  "bearing-mismatch": "Direction does not align",
  "drivable-network": "Drivable network requires review",
  "exact-match": "Handled by an identical-point merge",
  "feature-type-conflict": "Feature classifications conflict",
  "geometry-mismatch": "Geometry differs",
  "grade-change": "Would change the base point's level or layer",
  "grade-conflict": "Features are on incompatible levels",
  "length-mismatch": "Lengths differ",
  "many-to-one": "Multiple imported features share one base target",
  "merged-into-base": "Merged into a base feature instead",
  "multiple-targets": "Multiple possible base targets",
  "no-transferable-properties": "No selected tags differ",
  "node-context-conflict": "Connected paths have incompatible context",
  "non-routing-target": "Base target is not routable",
  "protected-tag": "Protected structural tag differs",
  "relation-member": "Feature belongs to an OSM relation",
  "replacement-anchor-shared":
    "A neighbouring replacement pairs a shared junction with a different imported point",
  "replacement-relation-member": "A point the replacement would delete belongs to a relation",
  "replacement-anchor-unpaired": "A base junction or tagged point is too far from the imported way",
  "replacement-direction-ambiguous": "Cannot tell which way the imported way runs",
  "replacement-direction-tag-conflict":
    "Side or direction tags (such as sidewalk or incline) disagree with the base way",
  "replacement-direction-tag-reversed":
    "The imported way runs the other way and lacks the base way's side or direction tags",
  "replacement-duplicate-node": "The imported way would pass through one point twice",
  "replacement-end-unpaired": "The base way's end is too far from the imported way's end",
  "replacement-restriction": "A turn restriction uses the base way",
  "routing-family-conflict": "Allowed travel is incompatible",
  "routing-property": "Tag affects travel and requires review",
  "traces-base-way": "Runs along this base path; replace it instead of connecting",
  "same-id": "Handled as a same-ID update",
  "unsupported-way-chain": "Matching one feature to several paths is unsupported",
  "would-collapse-way": "Connection would collapse a path",
  "way-removal-connection-required": "Accept the required connections before removal",
  "way-removal-topology-conflict": "Removal would change required network connections",
  "way-removal-routing-conflict": "Retained way does not have equivalent travel meaning",
  "way-removal-relation-member": "Related OSM relations prevent removal",
  "way-removal-unsupported": "A supported equivalent way is required for removal",
};

/** A reason code in words; unknown codes stay readable instead of disappearing. */
export function planReasonLabel(reason: string) {
  return REASON_LABEL[reason] ?? reason.replaceAll("-", " ");
}

/** Whether a proposal takes a decision: direct changes are what the patch says. */
export function isDecidable(proposal: PlanProposal) {
  return proposal.kind !== "add" && proposal.kind !== "same-id-replace";
}

/**
 * The decisions with `proposalId` set to `action`, or cleared when `action` is null. Accepting
 * also leaves out `excludes`: the proposal's alternatives, competitors and what it excludes.
 * `together` are proposals decided with it (a way replacement's set, MP-R2): their own
 * decisions are dropped, since the plan gives them this one.
 */
export function withDecision(
  decisions: readonly PlanDecision[],
  proposalId: string,
  action: PlanDecision["action"] | null,
  excludes: readonly string[] = [],
  together: readonly string[] = [],
): PlanDecision[] {
  // Including a proposal leaves out the ones it excludes (its alternatives and competitors),
  // so the decisions never include two that cannot both apply (MP-M5).
  const leaveOut = action === "accept" ? new Set(excludes) : new Set<string>();
  const decidedTogether = new Set(together);
  const rest = decisions.filter(
    ({ proposalId: id }) => id !== proposalId && !leaveOut.has(id) && !decidedTogether.has(id),
  );
  const leftOut = [...leaveOut].map((id) => ({ proposalId: id, action: "reject" as const }));
  return action ? [...rest, ...leftOut, { proposalId, action }] : rest;
}

/** A feature's heading: its name, or its type and patch ID. */
export function planFeatureTitle(
  feature: Pick<PlanFeature, "type" | "originalId"> & {
    name?: string;
  },
) {
  const type = feature.type === "node" ? "Point" : feature.type === "way" ? "Line" : "Relation";
  return feature.name ? feature.name : `${type} ${feature.originalId}`;
}

/** `node:-5` in words, for accessible names and secondary lines. */
export function planFeatureReference(feature: Pick<PlanFeature, "type" | "originalId">) {
  return `Imported ${feature.type} ${feature.originalId}`;
}

const toStem = (name: string | null | undefined) => {
  if (!name) return "dataset";
  return (
    name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "dataset"
  );
};

/** The merged PBF's suggested name, from both input names. */
export function makeMergedDownloadName(baseName?: string | null, patchName?: string | null) {
  const combined = `osmix-merged-${toStem(baseName)}-with-${toStem(patchName)}`;
  return `${combined.slice(0, 120)}.pbf`;
}

/** The osmChange download's suggested name. */
export function makePlanOscName(baseName?: string | null, patchName?: string | null) {
  return makeMergedDownloadName(baseName, patchName).replace(/\.pbf$/, ".osc");
}

const features = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? "feature" : "features"}`;

/** A bulk choice's button label, with how many shown features it would change. */
export function bulkActionLabel(action: MergePlanBulkRequest["action"], changed: number) {
  const verb = {
    accept: "Include",
    reject: "Leave out",
    clear: "Clear choices for",
    "pick-nearest": "Pick nearest for",
  }[action];
  return `${verb} ${features(changed)}`;
}

/** What a bulk choice did, in features, for the task's outcome. */
export function bulkResultMessage(
  action: MergePlanBulkRequest["action"],
  { changed, waiting }: MergePlanBulkCounts,
) {
  const verb = {
    accept: "Included",
    reject: "Left out",
    clear: "Cleared choices for",
    "pick-nearest": "Picked the nearest for",
  }[action];
  const done = changed === 0 ? "No shown feature changed" : `${verb} ${features(changed)}`;
  if (waiting === 0) return done;
  return `${done}; ${features(waiting)} still ${waiting === 1 ? "needs" : "need"} a decision`;
}

/** The automation levels, least to most, with what each decides for you. */
export const AUTOMATION_OPTIONS: readonly {
  value: MergePlanAutomation;
  label: string;
  help: string;
}[] = [
  {
    value: "conservative",
    label: "Conservative",
    help: "Every matching change waits for your review.",
  },
  {
    value: "recommended",
    label: "Recommended",
    help:
      "High-confidence changes apply. When several points of one imported way reach the same " +
      "base point, the clearly nearest one connects.",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    help:
      "Also picks the clearly nearest candidate in every other choice, and copies routing tags " +
      "(such as kerb or crossing) that have no competing choice.",
  },
];

export const AUTOMATION_LABEL = Object.fromEntries(
  AUTOMATION_OPTIONS.map(({ value, label }) => [value, label]),
) as Record<MergePlanAutomation, string>;

/** Why features wait for a decision, in words, most in need of a person first (MP-M7). */
export const CHOICE_GROUP_LABEL: Record<PlanChoiceGroup, string> = {
  removal: "Removals",
  individual: "Needs a closer look",
  replacement: "Base ways to replace",
  bend: "Connections that bend sharply",
  tie: "Choices to make yourself",
  nearest: "Choices with a clear nearest",
  "routing-tags": "Routing tag copies",
  other: "Other proposals",
};

export const CHOICE_GROUP_HELP: Record<PlanChoiceGroup, string> = {
  removal: "Removing an imported way needs its own Include on its row.",
  individual:
    "They change a point's grade (layer or level), the drivable network, travel restrictions, " +
    "a relation or a tagged point. " +
    "Decide each on its row.",
  replacement:
    "Imported ways that trace base ways. Including keeps the imported ways and deletes the base " +
    "ways; junctions and relations move to the imported ways.",
  bend:
    "A point along the imported line would join the base path at more than 30°. A path's end " +
    "may meet at any angle. Spot-check a few on the map, then include or leave them out together.",
  tie:
    "No candidate is clearly the one: they are about equally near, or the nearest bends sharply " +
    "or needs a closer look. Leaving them out keeps the imported points unconnected.",
  nearest: "One candidate is clearly nearest. Pick nearest includes it and leaves out the others.",
  "routing-tags": "Copying kerb, crossing or barrier values can change who can travel where.",
  other: "Proposals waiting for another reason.",
};
