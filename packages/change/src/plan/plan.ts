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
import { throttle } from "@osmix/shared/throttle";

import { applyChangesetToOsm } from "../apply-changeset.ts";
import { type CrossingInsertion, OsmChangeset, type OsmChangesetCheckpoint } from "../changeset.ts";
import { generateOscChanges, type OscOptions } from "../osc.ts";
import type { OsmChangesetStats } from "../types.ts";
import {
  entityToken,
  PLAN_PHASES,
  PlanBuilder,
  type PlanPhase,
  PROPOSAL_PHASE,
} from "./builder.ts";
import { pickNearestDecisions, type PlanChoices, planChoices } from "./choices.ts";
import { findDecisionConflict } from "./decision-conflict.ts";
import { planMatching } from "./matching.ts";
import { type PatchIdRemap, planPatchIdRemap, remappedCount, remapPatch } from "./remap.ts";
import type {
  MergePlan,
  MergePlanOptions,
  MergePlanSummary,
  PlanDecision,
  PlanInputIdentity,
  PlanProposalStatus,
} from "./types.ts";
import {
  type BaseRoutingStats,
  baseRoutingStats,
  PlannedRoutingStats,
  planRoutingDiagnostics,
} from "./validate.ts";

/** The live state behind a plan. Plans are rebuilt from their inputs, never deserialized. */
interface PlanState {
  base: Osm;
  /** The patch with planned IDs. */
  patch: Osm;
  remap: PatchIdRemap;
  options: MergePlanOptions;
  changeset: OsmChangeset;
  builder: PlanBuilder;
  /** The changeset as each phase found it, to replan from that phase. */
  checkpoints: Map<PlanPhase, OsmChangesetCheckpoint>;
  matched?: ReturnType<typeof planMatching>;
  /** The base's routing topology; the base does not change while planning. */
  baseRouting?: BaseRoutingStats;
  /** The planned result's routing topology, kept proportional to the plan's changes. */
  plannedRouting?: PlannedRoutingStats;
  log: (message: string) => void;
  hooks: MergePlanHooks;
}

/** Observe the planner, for profiling. */
export interface MergePlanHooks {
  /**
   * Wraps each phase, and the final checks as `check`, each time it runs. Call `run` exactly
   * once and return its result; `stats` reads the plan's change counts so far.
   */
  phase?: <T>(name: PlanPhase | "check", run: () => T, stats: () => OsmChangesetStats) => T;
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
 * `applyPlan` or `generateMergePlanOsc` in the same process, and change its decisions with
 * `setMergePlanDecisions`.
 */
export function planMerge(
  base: Osm,
  patch: Osm,
  options: MergePlanOptions = {},
  onProgress: (progress: ProgressEvent) => void = logProgress,
  hooks: MergePlanHooks = {},
): MergePlan {
  const inputs = { base: inputIdentity(base), patch: inputIdentity(patch) };
  const resolved: MergePlanOptions = {
    ...options,
    patchIds: options.patchIds ?? "osm",
    mergeIdenticalPoints: options.mergeIdenticalPoints ?? true,
    createIntersections: options.createIntersections ?? true,
    automation: options.automation ?? "recommended",
    ...(options.matching && options.automation === "conservative"
      ? { matching: { ...options.matching, automatic: "none" as const } }
      : {}),
    decisions: [...(options.decisions ?? [])],
  };
  const remap = planPatchIdRemap(base, patch, resolved.patchIds!);
  const planned = remapPatch(patch, remap);
  const builder = new PlanBuilder(remap, resolved.decisions);
  builder.groupFeatures(patch);
  const state: PlanState = {
    base,
    patch: planned,
    remap,
    options: resolved,
    changeset: new OsmChangeset(base),
    builder,
    checkpoints: new Map(),
    log: (message) => onProgress(progressEvent(message)),
    hooks,
  };
  const plan = {
    version: 1,
    inputs,
    options: resolved,
    idRemap: { mode: resolved.patchIds!, remapped: remappedCount(remap) },
    features: builder.features,
    proposals: builder.proposals,
  } as MergePlan;
  runPhases(plan, state, "direct");
  planStates.set(plan, state);
  return plan;
}

/**
 * Replace a plan's decisions and replan in place. Only the phases a changed decision can
 * affect run again, from the earliest; the result is the plan `planMerge` would make with
 * these decisions. A decision set that cannot apply throws and leaves the plan as it was:
 * `MergePlanDecisionConflictError` for two included proposals that exclude each other,
 * or the planner's own error, after replanning with the previous decisions.
 */
export function setMergePlanDecisions(plan: MergePlan, decisions: readonly PlanDecision[]) {
  const conflict = findDecisionConflict(plan.proposals, decisions);
  if (conflict) throw conflict;
  const state = planState(plan);
  const previous = plan.options.decisions ?? [];
  const before = new Map(previous.map((d) => [d.proposalId, d.action]));
  const after = new Map(decisions.map((d) => [d.proposalId, d.action]));
  let from: PlanPhase | undefined;
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(id) === after.get(id)) continue;
    const proposal = plan.proposals.get(id);
    // A decision naming no current proposal cannot change phases that do not run again.
    if (!proposal) continue;
    const phase = PROPOSAL_PHASE[proposal.kind];
    // Direct changes are not decided, so their decisions change nothing.
    if (phase === "direct") continue;
    if (!from || PLAN_PHASES.indexOf(phase) < PLAN_PHASES.indexOf(from)) from = phase;
  }
  const replan = (next: readonly PlanDecision[]) => {
    plan.options = { ...plan.options, decisions: [...next] };
    state.options = plan.options;
    state.builder.setDecisions(next);
    if (!from) {
      finishPlan(plan, state);
      return;
    }
    state.builder.dropFrom(from);
    state.changeset.restore(state.checkpoints.get(from)!);
    runPhases(plan, state, from, true);
  };
  try {
    replan(decisions);
  } catch (error) {
    // Replanning from the same phase with the previous decisions rebuilds the previous plan.
    replan(previous);
    throw error;
  }
  return plan;
}

/**
 * Run the planner's phases from `from` to the end, then check and summarize the plan. After a
 * restore to `from`'s checkpoint, that checkpoint already holds the state, so it is kept.
 */
function runPhases(plan: MergePlan, state: PlanState, from: PlanPhase, restored = false) {
  const { base, patch, changeset, builder, options, log, hooks } = state;
  const runs = (phase: PlanPhase) => PLAN_PHASES.indexOf(phase) >= PLAN_PHASES.indexOf(from);
  const phase = (name: PlanPhase, run: () => void) => {
    if (!runs(name)) return;
    // The direct phase never reruns, so its writes need no journal: the first mark follows it.
    if (name !== "direct" && !(restored && name === from)) {
      state.checkpoints.set(name, changeset.checkpoint());
    }
    if (hooks.phase) hooks.phase(name, run, () => changeset.stats);
    else run();
  };

  phase("direct", () => {
    log(`Planning direct changes from ${patch.id} to ${base.id}...`);
    changeset.generateDirectChanges(patch);
    builder.proposeDirectChanges(base, changeset);
  });
  phase("identity", () => {
    log(`Planning identical points and ways from ${patch.id}...`);
    planIdentity(builder, changeset, patch, options.mergeIdenticalPoints ? "automatic" : "review");
  });
  phase("matching", () => {
    if (options.matching) {
      log(`Planning matches from ${patch.id} to ${base.id}...`);
      // Discovery reads the state after identity, which a matching decision does not change.
      const cached =
        from === "matching" && state.matched
          ? {
              discovery: state.matched.discovery,
              demoted: state.matched.demotedCandidates,
              ...(state.matched.replacements ? { replacements: state.matched.replacements } : {}),
            }
          : undefined;
      state.matched = planMatching(
        builder,
        changeset,
        base,
        patch,
        options.matching,
        options.automation ?? "recommended",
        changeset.checkpointState(state.checkpoints.get("matching")!),
        cached,
      );
    }
  });
  phase("crossings", () => {
    if (options.createIntersections) {
      log(`Creating intersections from ${patch.id}...`);
      planCrossings(builder, changeset, patch, log);
    }
  });
  finishPlan(plan, state);
}

function finishPlan(plan: MergePlan, state: PlanState) {
  const { hooks, changeset } = state;
  if (hooks.phase)
    hooks.phase(
      "check",
      () => checkPlan(plan, state),
      () => changeset.stats,
    );
  else checkPlan(plan, state);
}

/** Base ways a way replacement may delete, whether or not it is decided yet. */
function replaceableBaseWays(plan: MergePlan) {
  const ids: number[] = [];
  for (const proposal of plan.proposals.values()) {
    if (proposal.kind === "replace-way") for (const { id } of proposal.replaces) ids.push(id);
  }
  return ids;
}

function checkPlan(plan: MergePlan, state: PlanState) {
  const { base, patch, changeset, builder, options, matched } = state;
  state.log("Checking the plan...");
  plan.diagnostics = {
    routing: planRoutingDiagnostics(
      (state.baseRouting ??= baseRoutingStats(base)),
      (state.plannedRouting ??= new PlannedRoutingStats(base, replaceableBaseWays(plan))),
      changeset.overlay,
    ),
    integrity: changeset.pendingIntegrityIssues(),
    demoted: matched?.demoted ?? [],
  };
  const { summary, staleDecisions } = builder.finish(base, patch, changeset, options);
  plan.summary = summary;
  plan.staleDecisions = staleDecisions;
  if (matched) plan.matching = matched.matching;
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
  const review = new Map<number, string[]>();
  for (const [sourceId, targetId] of changeset.planNodeReplacements(planned.nodes, review)) {
    const feature = builder.featureOfNode(sourceId);
    if (!feature) throw Error(`Exact match source ${sourceId} is not an imported point`);
    const proposal = builder.propose({
      id: `exact:${builder.originalToken("node", sourceId)}>${entityToken("node", targetId)}`,
      kind: "exact-merge",
      feature: feature.key,
      source: { type: "node", id: sourceId },
      target: { type: "node", id: targetId },
      // A merge that changes the base point's grade always waits for a person (MP-X1).
      status: review.has(sourceId) ? "review" : status,
      reasons: review.get(sourceId) ?? [],
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
function planCrossings(
  builder: PlanBuilder,
  changeset: OsmChangeset,
  planned: Osm,
  log: (message: string) => void,
) {
  const wayToken = (id: number) =>
    planned.ways.ids.has(id) ? builder.originalToken("way", id) : entityToken("way", id);
  const accept = (crossing: CrossingInsertion) => {
    // Two points at the same spot are the identity phase's decision: a crossing never merges
    // a pair whose exact merge was rejected or is still waiting.
    if (crossing.merges && exactMergeProposed(builder, planned, crossing.merges)) return false;
    const feature = builder.featureOfWay(crossing.wayId);
    if (!feature) throw Error(`Crossing way ${crossing.wayId} is not an imported way`);
    const point = crossing.point.map(coordinateToken).join(",");
    const kind = crossing.kind === "snap" ? "crossing-snap" : "crossing-node";
    const id = `${crossing.kind === "snap" ? "xsnap" : "xnode"}:${wayToken(crossing.wayId)}|${wayToken(crossing.otherWayId)}@${point}`;
    // A way passing through an imported vertex crosses both segments beside it at one point:
    // that is one crossing, already proposed and inserted once.
    if (builder.proposals.has(id)) return false;
    const proposal = builder.propose({
      id,
      kind,
      feature: feature.key,
      ways: [
        { type: "way", id: crossing.wayId },
        { type: "way", id: crossing.otherWayId },
      ],
      point: crossing.point,
      // A snap that changes the base point's grade always waits for a person (MP-X1).
      status: crossing.reviewReasons?.length ? "review" : "automatic",
      reasons: crossing.reviewReasons ?? [],
    });
    return proposal.effect === "applied";
  };
  let checked = 0;
  const progress = () =>
    `Intersection creation progress: ${checked.toLocaleString()} of ${planned.ways.size.toLocaleString()} ways checked`;
  const logEverySecond = throttle(() => log(progress()), 1_000);
  // Crossings read their starting state while they write: the one copy a replan takes.
  for (const _ of changeset.createPlannedIntersections(planned.ways, planned.nodes.ids, accept)) {
    checked++;
    logEverySecond();
  }
  if (checked > 0) log(progress());
}

/** A coordinate at stored precision, with a value that rounds to zero written as `0`. */
function coordinateToken(value: number) {
  const rounded = Math.round(value * 1e7) / 1e7;
  return (rounded === 0 ? 0 : rounded).toFixed(7);
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
  return planState(plan).matched?.discovery.candidates.find(
    ({ id }) => id === proposal.candidateId,
  );
}

function planCandidates(plan: MergePlan) {
  const candidates = planState(plan).matched?.discovery.candidates ?? [];
  return new Map(candidates.map((candidate) => [candidate.id, candidate]));
}

/** Why each imported feature still waits for a decision, one group per feature (MP-M7). */
export function getMergePlanChoices(plan: MergePlan): PlanChoices {
  return planChoices(plan, planCandidates(plan));
}

/**
 * A person's decisions picking the clearly nearest candidate among the choices of
 * `proposalIds`, by the automation levels' margin (MP-M6). Pass them to
 * `setMergePlanDecisions` with the plan's other decisions.
 */
export function pickNearestMergePlanDecisions(plan: MergePlan, proposalIds: Iterable<string>) {
  return pickNearestDecisions(plan, planCandidates(plan), proposalIds);
}

/** The plan's changes as an osmChange document. */
export function generateMergePlanOsc(plan: MergePlan, options: Partial<OscOptions> = {}) {
  return generateOscChanges(planState(plan).changeset, options);
}
