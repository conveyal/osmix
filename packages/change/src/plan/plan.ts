/**
 * Plan a merge once, review it by imported feature, apply it once.
 *
 * `planMerge` reads the base and the patch and records every change it would make as pending
 * records in one overlay, grouped into features and proposals. Nothing is built until
 * `applyPlan`, which materializes the records in a single pass and validates the result.
 *
 * Phases, in order: direct and same-ID changes; identity (imported points at identical
 * coordinates, then ways that became identical); matching, when configured; crossings.
 */
import type { Osm } from "@osmix/core";
import { logProgress, type ProgressEvent, progressEvent } from "@osmix/shared/progress";

import { applyChangesetToOsm } from "../apply-changeset.ts";
import { type CrossingInsertion, OsmChangeset } from "../changeset.ts";
import { generateOscChanges, type OscOptions } from "../osc.ts";
import type { OsmChangesetStats } from "../types.ts";
import type { OsmConflationDiscovery } from "../types.ts";
import { entityToken, PlanBuilder } from "./builder.ts";
import { planMatching } from "./matching.ts";
import { type PatchIdRemap, planPatchIdRemap, remappedCount, remapPatch } from "./remap.ts";
import type {
  MergePlan,
  MergePlanOptions,
  MergePlanSummary,
  PlanInputIdentity,
  PlanProposalStatus,
} from "./types.ts";
import { planRoutingDiagnostics } from "./validate.ts";

/** The live state behind a plan. Plans are rebuilt from their inputs, never deserialized. */
interface PlanState {
  base: Osm;
  /** The patch with planned IDs. */
  patch: Osm;
  remap: PatchIdRemap;
  changeset: OsmChangeset;
  discovery?: OsmConflationDiscovery;
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

/**
 * Plan merging `patch` into `base`. Neither input changes. The plan is live: pass it to
 * `applyPlan` or `generateMergePlanOsc` in the same process. To change a decision, plan again
 * with the new decisions.
 */
export function planMerge(
  base: Osm,
  patch: Osm,
  options: MergePlanOptions = {},
  onProgress: (progress: ProgressEvent) => void = logProgress,
): MergePlan {
  const log = (message: string) => onProgress(progressEvent(message));
  const inputs = { base: inputIdentity(base), patch: inputIdentity(patch) };
  const resolved: MergePlanOptions = {
    ...options,
    patchIds: options.patchIds ?? "osm",
    mergeIdenticalPoints: options.mergeIdenticalPoints ?? true,
    createIntersections: options.createIntersections ?? true,
  };
  const remap = planPatchIdRemap(base, patch, resolved.patchIds!);
  const planned = remapPatch(patch, remap);
  const changeset = new OsmChangeset(base);
  const builder = new PlanBuilder(remap, options.decisions);
  builder.groupFeatures(patch);

  log(`Planning direct changes from ${patch.id} to ${base.id}...`);
  changeset.generateDirectChanges(planned);
  builder.proposeDirectChanges(base, changeset);

  log(`Planning identical points and ways from ${patch.id}...`);
  planIdentity(builder, changeset, planned, resolved.mergeIdenticalPoints ? "automatic" : "review");

  let matched: ReturnType<typeof planMatching> | undefined;
  if (options.matching) {
    log(`Planning matches from ${patch.id} to ${base.id}...`);
    matched = planMatching(builder, changeset, base, planned, options.matching);
  }

  if (resolved.createIntersections) {
    log(`Planning crossings for ${patch.id}...`);
    planCrossings(builder, changeset, planned);
  }

  log("Checking the plan...");
  const diagnostics = {
    routing: planRoutingDiagnostics(base, changeset.overlay),
    integrity: changeset.pendingIntegrityIssues(),
    demoted: matched?.demoted ?? [],
  };
  const { summary, staleDecisions } = builder.finish(base, planned, changeset, resolved);
  const plan: MergePlan = {
    version: 1,
    inputs,
    options: resolved,
    idRemap: { mode: resolved.patchIds!, remapped: remappedCount(remap) },
    features: builder.features,
    proposals: builder.proposals,
    summary,
    staleDecisions,
    ...(matched ? { matching: matched.matching } : {}),
    diagnostics,
  };
  planStates.set(plan, {
    base,
    patch: planned,
    remap,
    changeset,
    ...(matched ? { discovery: matched.discovery } : {}),
  });
  return plan;
}

/**
 * Imported points at a base point's exact coordinate, then imported ways identical to a base
 * way once those points merge. Each is a proposal; only applied ones change the plan, so a way
 * can match only through point merges that are applied.
 */
function planIdentity(
  builder: PlanBuilder,
  changeset: OsmChangeset,
  planned: Osm,
  status: PlanProposalStatus,
) {
  const accepted = new Map<number, number>();
  for (const [sourceId, targetId] of changeset.planNodeReplacements(planned.nodes)) {
    const feature = builder.featureOfNode(sourceId);
    if (!feature) throw Error(`Exact match source ${sourceId} is not an imported point`);
    const proposal = builder.propose({
      id: `exact:${builder.originalToken("node", sourceId)}>${entityToken("node", targetId)}`,
      kind: "exact-merge",
      feature: feature.key,
      source: { type: "node", id: sourceId },
      target: { type: "node", id: targetId },
      status,
      reasons: [],
    });
    if (proposal.effect === "applied") accepted.set(sourceId, targetId);
  }
  changeset.applyNodeReplacements(accepted);

  const accept = (sourceId: number, targetId: number) => {
    const feature = builder.featureOfWay(sourceId);
    if (!feature) throw Error(`Exact way match source ${sourceId} is not an imported way`);
    const proposal = builder.propose({
      id: `reconcile:${builder.originalToken("way", sourceId)}>${entityToken("way", targetId)}`,
      kind: "way-reconcile",
      feature: feature.key,
      source: { type: "way", id: sourceId },
      target: { type: "way", id: targetId },
      status,
      reasons: [],
    });
    return proposal.effect === "applied";
  };
  for (const _ of changeset.deduplicateWaysGenerator(planned.ways, new Map(), accept));
}

/**
 * Crossings between surviving imported ways and the ways they cross, found on the planned
 * state. Every crossing is an automatic proposal; rejecting one leaves that pair unconnected.
 */
function planCrossings(builder: PlanBuilder, changeset: OsmChangeset, planned: Osm) {
  const wayToken = (id: number) =>
    planned.ways.ids.has(id) ? builder.originalToken("way", id) : entityToken("way", id);
  const accept = (crossing: CrossingInsertion) => {
    // Two points at the same spot are the identity phase's decision: a crossing never merges
    // a pair whose exact merge was rejected or is still waiting.
    if (crossing.merges && exactMergeProposed(builder, planned, crossing.merges)) return false;
    const feature = builder.featureOfWay(crossing.wayId);
    if (!feature) throw Error(`Crossing way ${crossing.wayId} is not an imported way`);
    const point = crossing.point.map((value) => value.toFixed(7)).join(",");
    const kind = crossing.kind === "snap" ? "crossing-snap" : "crossing-node";
    const proposal = builder.propose({
      id: `${crossing.kind === "snap" ? "xsnap" : "xnode"}:${wayToken(crossing.wayId)}|${wayToken(crossing.otherWayId)}@${point}`,
      kind,
      feature: feature.key,
      ways: [
        { type: "way", id: crossing.wayId },
        { type: "way", id: crossing.otherWayId },
      ],
      point: crossing.point,
      status: "automatic",
      reasons: [],
    });
    return proposal.effect === "applied";
  };
  for (const _ of changeset.createPlannedIntersections(planned.ways, planned.nodes.ids, accept));
}

function exactMergeProposed(
  builder: PlanBuilder,
  planned: Osm,
  { replaced, survivor }: { replaced: number; survivor: number },
) {
  for (const [source, target] of [
    [replaced, survivor],
    [survivor, replaced],
  ] as const) {
    if (!planned.nodes.ids.has(source)) continue;
    const id = `exact:${builder.originalToken("node", source)}>${entityToken("node", target)}`;
    if (builder.proposals.has(id)) return true;
  }
  return false;
}

export interface MergePlanResult {
  osm: Osm;
  summary: MergePlanSummary;
  stats: OsmChangesetStats;
}

/**
 * Build the merged dataset the plan describes: one full build, then the routing-integrity
 * check. Proposals still waiting for a decision are left out. The plan and its inputs are
 * unchanged, so applying twice gives the same result.
 *
 * @throws When the plan's diagnostics list routing-integrity problems; nothing is built.
 */
export function applyPlan(plan: MergePlan, newOsmId?: string): MergePlanResult {
  const { changeset } = planState(plan);
  if (plan.diagnostics.integrity.length > 0) {
    const shown = plan.diagnostics.integrity.slice(0, 10);
    const omitted = plan.diagnostics.integrity.length - shown.length;
    throw Error(
      `Merge introduced routing-integrity problems: ${shown.join("; ")}${omitted > 0 ? `; and ${omitted} more` : ""}`,
    );
  }
  const osm = applyChangesetToOsm(changeset, newOsmId);
  return { osm, summary: plan.summary, stats: changeset.stats };
}

/** The matching candidate behind a matching proposal: its evidence and every assessment. */
export function getMergePlanCandidate(plan: MergePlan, proposalId: string) {
  const proposal = plan.proposals.get(proposalId);
  if (!proposal || !("candidateId" in proposal)) return undefined;
  return planState(plan).discovery?.candidates.find(({ id }) => id === proposal.candidateId);
}

/** The plan's changes as an osmChange document. */
export function generateMergePlanOsc(plan: MergePlan, options: Partial<OscOptions> = {}) {
  return generateOscChanges(planState(plan).changeset, options);
}
