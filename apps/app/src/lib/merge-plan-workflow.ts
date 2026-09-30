import type {
  MergePlanBulkCounts,
  MergePlanBulkRequest,
  MergePlanOptions,
  OsmConflationOptions,
  PatchIdMode,
  PlanDecision,
  PlanFeature,
  PlanOutcome,
  PlanProposal,
  PlanProposalEffect,
  PlanProposalStatus,
} from "osmix";

/** Plan options from the input step's settings. */
export function buildMergePlanOptions({
  matching,
  mergeIdenticalPoints,
  patchIds,
}: {
  matching?: OsmConflationOptions;
  mergeIdenticalPoints: boolean;
  patchIds: PatchIdMode;
}): MergePlanOptions {
  return {
    mergeIdenticalPoints,
    patchIds,
    ...(matching ? { matching: { ...matching, propertyKeys: [...matching.propertyKeys] } } : {}),
  };
}

/** Outcomes in the order the review lists them. */
export const OUTCOMES: readonly PlanOutcome[] = [
  "needs-decision",
  "removed",
  "merged",
  "connected",
  "replaced",
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
  replaced: "Its positive ID edits a base entity with the same ID",
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
  "crossing-snap",
  "crossing-node",
];

const REASON_LABEL: Record<string, string> = {
  "bearing-mismatch": "Direction does not align",
  "drivable-network": "Drivable network requires review",
  "exact-match": "Handled by an identical-point merge",
  "feature-type-conflict": "Feature classifications conflict",
  "geometry-mismatch": "Geometry differs",
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
  "routing-family-conflict": "Allowed travel is incompatible",
  "routing-property": "Tag affects travel and requires review",
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
 * also leaves out `excludes`: the proposal's alternatives and competitors.
 */
export function withDecision(
  decisions: readonly PlanDecision[],
  proposalId: string,
  action: PlanDecision["action"] | null,
  excludes: readonly string[] = [],
): PlanDecision[] {
  // Including a proposal leaves out the ones it excludes (its alternatives and competitors),
  // so the decisions never include two that cannot both apply (MP-M5).
  const leaveOut = action === "accept" ? new Set(excludes) : new Set<string>();
  const rest = decisions.filter(
    (decision) => decision.proposalId !== proposalId && !leaveOut.has(decision.proposalId),
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
  const verb = { accept: "Include", reject: "Leave out", clear: "Clear choices for" }[action];
  return `${verb} ${features(changed)}`;
}

/** What a bulk choice did, in features, for the task's outcome. */
export function bulkResultMessage(
  action: MergePlanBulkRequest["action"],
  { changed, waiting }: MergePlanBulkCounts,
) {
  const verb = { accept: "Included", reject: "Left out", clear: "Cleared choices for" }[action];
  const done = changed === 0 ? "No shown feature changed" : `${verb} ${features(changed)}`;
  if (waiting === 0) return done;
  return `${done}; ${features(waiting)} still ${waiting === 1 ? "needs" : "need"} a decision`;
}
