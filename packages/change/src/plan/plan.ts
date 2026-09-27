/**
 * Plan a merge once, review it by imported feature, apply it once.
 *
 * `planMerge` reads the base and the patch and records every change it would make as pending
 * records in one overlay, grouped into features and proposals. Nothing is built until
 * `applyPlan`, which materializes the records in a single pass and validates the result.
 */
import type { Osm } from "@osmix/core";
import { logProgress, type ProgressEvent, progressEvent } from "@osmix/shared/progress";
import type { GeoBbox2D, OsmEntityType } from "@osmix/types";

import { applyChangesetToOsm } from "../apply-changeset.ts";
import { OsmChangeset } from "../changeset.ts";
import { generateOscChanges, type OscOptions } from "../osc.ts";
import type { OsmChangesetStats } from "../types.ts";
import {
  type PatchIdRemap,
  planPatchIdRemap,
  remapId,
  remappedCount,
  remapPatch,
} from "./remap.ts";
import {
  type MergePlan,
  type MergePlanOptions,
  type MergePlanSummary,
  PLAN_OUTCOME_PRIORITY,
  type PlanFeature,
  type PlanInputIdentity,
  type PlanOutcome,
  type PlanProposal,
} from "./types.ts";

/** The live state behind a plan. Plans are rebuilt from their inputs, never deserialized. */
interface PlanState {
  base: Osm;
  /** The patch with planned IDs. */
  patch: Osm;
  remap: PatchIdRemap;
  changeset: OsmChangeset;
}

const planStates = new WeakMap<MergePlan, PlanState>();

function planState(plan: MergePlan): PlanState {
  const state = planStates.get(plan);
  if (!state) {
    throw Error("Not a live merge plan; plans are rebuilt from their inputs with planMerge()");
  }
  return state;
}

function inputIdentity(osm: Osm): PlanInputIdentity {
  const contentHash = osm.contentHash();
  if (contentHash === "") throw Error(`Build indexes for ${osm.id} before planning a merge`);
  return { id: osm.id, contentHash };
}

const TYPE_LETTER: Record<OsmEntityType, string> = { node: "n", way: "w", relation: "r" };

/** `n-5`, `w44`: an entity reference that reads the same in every proposal ID. */
export function entityToken(type: OsmEntityType, id: number) {
  return `${TYPE_LETTER[type]}${id}`;
}

/**
 * Plan merging `patch` into `base`. Neither input changes. The plan is live: pass it to
 * `applyPlan` or `generateMergePlanOsc` in the same process.
 */
export function planMerge(
  base: Osm,
  patch: Osm,
  options: MergePlanOptions = {},
  onProgress: (progress: ProgressEvent) => void = logProgress,
): MergePlan {
  const inputs = { base: inputIdentity(base), patch: inputIdentity(patch) };
  const mode = options.patchIds ?? "osm";
  const remap = planPatchIdRemap(base, patch, mode);
  const planned = remapPatch(patch, remap);
  const changeset = new OsmChangeset(base);
  onProgress(progressEvent(`Planning direct changes from ${patch.id} to ${base.id}...`));
  changeset.generateDirectChanges(planned);

  const { features, proposals } = groupFeatures(base, patch, remap, changeset);
  const plan: MergePlan = {
    version: 1,
    inputs,
    options: { ...options, patchIds: mode },
    idRemap: { mode, remapped: remappedCount(remap) },
    features,
    proposals,
    summary: summarize(base, planned, features, proposals, mode),
  };
  planStates.set(plan, { base, patch: planned, remap, changeset });
  return plan;
}

export interface MergePlanResult {
  osm: Osm;
  summary: MergePlanSummary;
  stats: OsmChangesetStats;
}

/**
 * Build the merged dataset the plan describes: one full build, then the routing-integrity
 * check. The plan and its inputs are unchanged, so applying twice gives the same result.
 */
export function applyPlan(plan: MergePlan, newOsmId?: string): MergePlanResult {
  const { changeset } = planState(plan);
  const osm = applyChangesetToOsm(changeset, newOsmId);
  return { osm, summary: plan.summary, stats: changeset.stats };
}

/** The plan's changes as an osmChange document. */
export function generateMergePlanOsc(plan: MergePlan, options: Partial<OscOptions> = {}) {
  return generateOscChanges(planState(plan).changeset, options);
}

/**
 * One feature per patch way (with its vertices), per patch node no patch way uses, and per
 * patch relation, in patch order. Direct proposals: `add` for a created entity and
 * `same-id-replace` for each base entity a positive patch ID edits.
 */
function groupFeatures(base: Osm, patch: Osm, remap: PatchIdRemap, changeset: OsmChangeset) {
  const features: PlanFeature[] = [];
  const proposals = new Map<string, PlanProposal>();
  const claimedVertices = new Set<number>();

  const directProposal = (
    feature: PlanFeature,
    type: OsmEntityType,
    originalId: number,
    plannedId: number,
  ) => {
    const change = changeset.changes(type)[plannedId];
    if (!change) return;
    const proposal: PlanProposal =
      change.changeType === "create"
        ? {
            id: `add:${entityToken(type, originalId)}`,
            kind: "add",
            feature: feature.key,
            status: "automatic",
            reasons: [],
            effect: "applied",
          }
        : {
            id: `replace:${entityToken(type, plannedId)}`,
            kind: "same-id-replace",
            feature: feature.key,
            entity: { type, id: plannedId },
            status: "automatic",
            reasons: [],
            effect: "applied",
          };
    proposals.set(proposal.id, proposal);
    feature.proposalIds.push(proposal.id);
  };

  const referencedNodes = new Set<number>();
  for (const way of patch.ways) {
    for (const ref of way.refs) referencedNodes.add(ref);
    const id = remapId(remap, "way", way.id);
    const feature: PlanFeature = {
      key: `way:${way.id}`,
      type: "way",
      originalId: way.id,
      id,
      vertexIds: way.refs.map((ref) => remapId(remap, "node", ref)),
      outcome: "unchanged",
      proposalIds: [],
      bbox: patch.ways.getEntityBbox({ id: way.id }),
    };
    directProposal(feature, "way", way.id, id);
    for (const ref of way.refs) {
      const vertexId = remapId(remap, "node", ref);
      // A vertex that edits a base node is its own proposal, on the first way that uses it.
      if (claimedVertices.has(vertexId) || !base.nodes.ids.has(vertexId)) continue;
      claimedVertices.add(vertexId);
      directProposal(feature, "node", ref, vertexId);
    }
    features.push(feature);
  }
  for (const node of patch.nodes) {
    if (referencedNodes.has(node.id)) continue;
    const id = remapId(remap, "node", node.id);
    const bbox: GeoBbox2D = [node.lon, node.lat, node.lon, node.lat];
    const feature: PlanFeature = {
      key: `node:${node.id}`,
      type: "node",
      originalId: node.id,
      id,
      outcome: "unchanged",
      proposalIds: [],
      bbox,
    };
    directProposal(feature, "node", node.id, id);
    features.push(feature);
  }
  for (const relation of patch.relations) {
    const id = remapId(remap, "relation", relation.id);
    const feature: PlanFeature = {
      key: `relation:${relation.id}`,
      type: "relation",
      originalId: relation.id,
      id,
      outcome: "unchanged",
      proposalIds: [],
      bbox: null,
    };
    directProposal(feature, "relation", relation.id, id);
    features.push(feature);
  }
  for (const feature of features) feature.outcome = featureOutcome(feature, proposals);
  return { features, proposals };
}

const PROPOSAL_OUTCOME: Record<PlanProposal["kind"], PlanOutcome> = {
  add: "added",
  "same-id-replace": "replaced",
};

function featureOutcome(feature: PlanFeature, proposals: Map<string, PlanProposal>): PlanOutcome {
  let best = PLAN_OUTCOME_PRIORITY.indexOf("unchanged");
  for (const id of feature.proposalIds) {
    const proposal = proposals.get(id)!;
    const outcome =
      proposal.effect === "needs-decision" ? "needs-decision" : PROPOSAL_OUTCOME[proposal.kind];
    best = Math.min(best, PLAN_OUTCOME_PRIORITY.indexOf(outcome));
  }
  return PLAN_OUTCOME_PRIORITY[best]!;
}

function summarize(
  base: Osm,
  planned: Osm,
  features: readonly PlanFeature[],
  proposals: Map<string, PlanProposal>,
  mode: MergePlanOptions["patchIds"],
): MergePlanSummary {
  const summary: MergePlanSummary = {
    features: Object.fromEntries(PLAN_OUTCOME_PRIORITY.map((outcome) => [outcome, 0])) as Record<
      PlanOutcome,
      number
    >,
    proposals: { automatic: 0, review: 0, blocked: 0 },
    replacesBase: 0,
  };
  for (const feature of features) summary.features[feature.outcome]++;
  for (const proposal of proposals.values()) summary.proposals[proposal.status]++;
  if (mode === "new") return summary;
  for (const [ids, baseIds] of [
    [planned.nodes.ids, base.nodes.ids],
    [planned.ways.ids, base.ways.ids],
    [planned.relations.ids, base.relations.ids],
  ] as const) {
    for (let index = 0; index < ids.size; index++) {
      const id = ids.at(index);
      if (id > 0 && baseIds.has(id)) summary.replacesBase++;
    }
  }
  return summary;
}
