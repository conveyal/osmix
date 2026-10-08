/**
 * The matching phase: imported features near base features, found on the planned state after
 * the direct and identity phases. Each candidate action is a proposal; decisions on proposals
 * become the matching decisions the application rules already enforce (MP-M2, MP-M3, MP-R1).
 */
import type { Osm } from "@osmix/core";

import type { OsmChangeset } from "../changeset.ts";
import {
  applyPlannedConflation,
  discoverPlannedConflationCandidates,
  refreshConflationWayRemovalAssessments,
} from "../conflation.ts";
import { inputProvenance } from "../provenance.ts";
import type {
  OsmConflationActionAssessment,
  OsmConflationCandidate,
  OsmConflationDecision,
  OsmConflationDiscovery,
} from "../types.ts";
import { automateMatching } from "./automation.ts";
import { entityToken, type PlanBuilder } from "./builder.ts";
import { findDecisionConflict } from "./decision-conflict.ts";
import type { EarlierState } from "./overlay.ts";
import { discoverWayReplacements, type WayReplacementDiscovery } from "./replacement.ts";
import {
  applyWayReplacements,
  leaveOutExcluded,
  linkReplacementExclusions,
  proposeWayReplacements,
  settleReplacementSets,
} from "./replacing.ts";
import type {
  MatchingProposal,
  MergePlan,
  MergePlanAutomation,
  MergePlanOptions,
  PlanConnectionRivalry,
  PlanProposal,
} from "./types.ts";
import { demoteDrivableConnections } from "./validate.ts";
import { plannedMatchingViews } from "./views.ts";

type MatchingKind = "connect" | "copy-tags" | "remove-way";

const PROPOSAL_PREFIX: Record<MatchingKind, string> = {
  connect: "connect",
  "copy-tags": "copy",
  "remove-way": "remove",
};

interface CandidateProposals {
  candidate: OsmConflationCandidate;
  /** The ID a removal proposal for this candidate has, if it can have one. */
  removalId?: string;
  connect?: PlanProposal;
  copy?: PlanProposal;
  remove?: PlanProposal;
}

export function planMatching(
  builder: PlanBuilder,
  changeset: OsmChangeset,
  base: Osm,
  planned: Osm,
  options: NonNullable<MergePlanOptions["matching"]>,
  automation: MergePlanAutomation,
  /** The planned state as matching starts, read by ID; matching reports against it. */
  start: EarlierState,
  /** Discovery from an earlier run on the same state, reused when only decisions changed. */
  cached?: {
    discovery: OsmConflationDiscovery;
    demoted: ReadonlySet<string>;
    replacements?: WayReplacementDiscovery;
  },
): {
  discovery: OsmConflationDiscovery;
  demotedCandidates: ReadonlySet<string>;
  replacements?: WayReplacementDiscovery;
  matching: NonNullable<MergePlan["matching"]>;
  demoted: string[];
} {
  if ("decisions" in options) {
    throw Error("Decide matching proposals with plan decisions, not matching.decisions");
  }
  const discovery =
    cached?.discovery ??
    discoverPlannedConflationCandidates(base, planned, changeset.overlay, options);
  const demoted =
    cached?.demoted ??
    new Set(demoteDrivableConnections(discovery, changeset.overlay).map(({ id }) => id));
  const byCandidate: CandidateProposals[] = [];
  const propose = (
    candidate: OsmConflationCandidate,
    kind: MatchingKind,
    assessment: OsmConflationActionAssessment | null | undefined,
  ) => {
    if (!assessment || assessment.status === "unmatched" || candidate.targetId == null) return;
    // Copying selected tags that already agree, or that the source lacks, changes nothing, so
    // it is not a proposal (MP-M3).
    if (kind === "copy-tags" && nothingToCopy(assessment)) return;
    const type = candidate.entityType;
    const feature =
      type === "node"
        ? builder.featureOfNode(candidate.sourceId)
        : builder.featureOfWay(candidate.sourceId);
    if (!feature) throw Error(`Matching source ${type} ${candidate.sourceId} is not imported`);
    const source = builder.originalToken(type, candidate.sourceId);
    return builder.propose({
      id: `${PROPOSAL_PREFIX[kind]}:${source}>${entityToken(type, candidate.targetId)}`,
      kind,
      feature: feature.key,
      source: { type, id: candidate.sourceId },
      target: { type, id: candidate.targetId },
      candidateId: candidate.id,
      alternatives: [],
      competitors: [],
      status: assessment.status,
      reasons: [...assessment.reasons],
    });
  };
  const candidates = new Map(discovery.candidates.map((candidate) => [candidate.id, candidate]));
  for (const candidate of discovery.candidates) {
    byCandidate.push({
      candidate,
      ...(candidate.entityType === "way" && candidate.targetId != null
        ? {
            removalId: `remove:${builder.originalToken("way", candidate.sourceId)}>${entityToken("way", candidate.targetId)}`,
          }
        : {}),
      connect: propose(candidate, "connect", candidate.networkAttachment),
      copy: propose(candidate, "copy-tags", candidate.propertyTransfer),
    });
  }
  // Replacements (MP-R2) settle first: an included one leaves out the connections it makes
  // unnecessary, so automation never picks one of those.
  const level = options.automatic === "none" ? "conservative" : automation;
  const replacementDiscovery = discovery.options.allowWayReplacement
    ? (cached?.replacements ?? discoverPlannedReplacements(changeset, base, planned, discovery))
    : undefined;
  const replacements = replacementDiscovery
    ? proposeWayReplacements(builder, replacementDiscovery)
    : [];
  const wayRefs = (id: number) => changeset.overlay.getWay(id)?.refs ?? [];
  linkReplacementExclusions(replacements, builder.proposals, wayRefs);
  const replacing = settleReplacementSets(replacements, level);
  leaveOutExcluded(replacing, builder.proposals);
  // Automation settles choices before removal is assessed, since removal depends on which
  // connections apply. It needs the alternatives and competitors linked first.
  if (automation !== "conservative" && options.automatic !== "none") {
    linkAlternatives(byCandidate, (wayId) => builder.originalId("way", wayId));
    automateMatching(automation, builder.proposals, candidates);
  }
  // Removal eligibility depends on which connections are accepted, so assess it last.
  const draft = matchingDecisions(byCandidate, (id) => builder.decisionFor(id));
  refreshConflationWayRemovalAssessments(base, planned, discovery, draft);
  for (const entry of byCandidate) {
    const removal = entry.candidate.wayRemoval;
    if (removal?.status === "review" || removal?.status === "blocked") {
      entry.remove = propose(entry.candidate, "remove-way", removal);
    }
  }
  linkAlternatives(byCandidate, (wayId) => builder.originalId("way", wayId));
  linkReplacementExclusions(replacements, builder.proposals, wayRefs);
  leaveOutExcluded(replacing, builder.proposals);
  const conflict = findDecisionConflict(builder.proposals, builder.decisionList());
  if (conflict) throw conflict;

  const decisions = matchingDecisions(byCandidate);
  const kept = replacing.flatMap(({ group }) => group.importedWayIds);
  const refsBefore = new Map(kept.map((id) => [id, [...wayRefs(id)]]));
  const outcome = applyPlannedConflation(changeset, base, planned, discovery, decisions, start);
  applyWayReplacements(
    changeset,
    base,
    replacing.map(({ group }) => group),
    refsBefore,
    start,
  );
  const demotedProposals = byCandidate.flatMap(({ candidate, connect }) =>
    connect && demoted.has(candidate.id) ? [connect.id] : [],
  );
  return {
    discovery,
    demotedCandidates: demoted,
    ...(replacementDiscovery ? { replacements: replacementDiscovery } : {}),
    matching: { candidates: discovery.summary, outcome },
    demoted: demotedProposals,
  };
}

/**
 * One matching decision per candidate with a decided proposal: accept with the actions whose
 * proposals apply, or reject when none do. Undecided candidates follow their automatic status.
 * `pendingRemoval` supplies removal decisions before removal proposals exist.
 */
function matchingDecisions(
  entries: readonly CandidateProposals[],
  pendingRemoval?: (proposalId: string) => "accept" | "reject" | undefined,
): OsmConflationDecision[] {
  const decisions: OsmConflationDecision[] = [];
  for (const { candidate, removalId, connect, copy, remove } of entries) {
    const removalDecision = remove?.decision ?? (removalId && pendingRemoval?.(removalId));
    const decided = [connect, copy].some((proposal) => proposal?.decision) || removalDecision;
    if (!decided) continue;
    const applies = (proposal: PlanProposal | undefined) => proposal?.effect === "applied";
    const removeWay = remove ? applies(remove) : removalDecision === "accept";
    if (!applies(connect) && !applies(copy) && !removeWay) {
      decisions.push({ candidateId: candidate.id, action: "reject" });
      continue;
    }
    decisions.push({
      candidateId: candidate.id,
      action: "accept",
      transferProperties: applies(copy),
      attachNetwork: applies(connect),
      ...(removeWay ? { removeWay: true } : {}),
    });
  }
  return decisions;
}

/** A connection blocked as a copy of the base path is never a choice (MP-M1). */
const tracesBase = (proposal: PlanProposal) =>
  proposal.status === "blocked" && proposal.reasons.includes("traces-base-way");

function linkAlternatives(
  entries: readonly CandidateProposals[],
  originalWayId: (wayId: number) => number,
) {
  for (const kind of ["connect", "copy", "remove"] as const) {
    const bySource = new Map<string, PlanProposal[]>();
    for (const entry of entries) {
      const proposal = entry[kind];
      if (!proposal || !("alternatives" in proposal) || tracesBase(proposal)) continue;
      const key = `${proposal.source.type}:${proposal.source.id}`;
      bySource.set(key, [...(bySource.get(key) ?? []), proposal]);
    }
    for (const group of bySource.values()) {
      if (group.length < 2) continue;
      for (const proposal of group) {
        if (!("alternatives" in proposal)) continue;
        proposal.alternatives = group.filter((other) => other !== proposal).map(({ id }) => id);
      }
    }
  }
  linkCompetitors(entries, originalWayId);
}

/** A copy assessment blocked only because no selected tag differs. */
function nothingToCopy({ status, reasons }: OsmConflationActionAssessment) {
  return status === "blocked" && reasons.every((reason) => reason === "no-transferable-properties");
}

/**
 * Link proposals that cannot all apply (MP-M5). A base node takes several connections, but
 * not two from one imported way or two that would join different grades there (discovery's
 * `connectionRivals`). A base way takes one
 * imported way's copy or removal. Several copies onto one base node can apply together, so
 * they do not compete.
 */
function linkCompetitors(
  entries: readonly CandidateProposals[],
  /** A planned way ID as the patch has it, for naming a shared way. */
  originalWayId: (wayId: number) => number,
) {
  const connectByCandidate = new Map(
    entries.flatMap(({ candidate, connect }) => (connect ? [[candidate.id, connect]] : [])),
  );
  for (const { candidate, connect } of entries) {
    if (!connect || !("competitors" in connect) || tracesBase(connect)) continue;
    const rivalries: Record<string, PlanConnectionRivalry> = {};
    for (const { candidateId, sharedWayId } of candidate.connectionRivals ?? []) {
      const rival = connectByCandidate.get(candidateId);
      if (!rival || tracesBase(rival)) continue;
      rivalries[rival.id] =
        sharedWayId === undefined ? { grades: true } : { sharedWay: originalWayId(sharedWayId) };
    }
    connect.competitors = Object.keys(rivalries);
    if (connect.competitors.length > 0 && connect.kind === "connect") connect.rivalries = rivalries;
  }
  const byTarget = new Map<string, MatchingProposal[]>();
  const add = (proposal: PlanProposal | undefined) => {
    if (!proposal || !("competitors" in proposal) || tracesBase(proposal)) return;
    const { kind, target } = proposal;
    if (kind === "connect" || (kind === "copy-tags" && target.type === "node")) return;
    const slot = `way:${target.id}`;
    byTarget.set(slot, [...(byTarget.get(slot) ?? []), proposal]);
  };
  for (const { copy, remove } of entries) {
    add(copy);
    add(remove);
  }
  const sourceKey = ({ source }: MatchingProposal) => `${source.type}:${source.id}`;
  for (const group of byTarget.values()) {
    for (const proposal of group) {
      proposal.competitors = group
        .filter((other) => sourceKey(other) !== sourceKey(proposal))
        .map(({ id }) => id);
    }
  }
}

/** Find the replacements on the state matching reads, at the discovery's tolerance (MP-R2). */
function discoverPlannedReplacements(
  changeset: OsmChangeset,
  base: Osm,
  planned: Osm,
  discovery: OsmConflationDiscovery,
) {
  const { baseView, patchView } = plannedMatchingViews(
    changeset.overlay,
    base,
    planned,
    inputProvenance(base, planned),
  );
  const tolerance = discovery.options.replacementToleranceMeters;
  if (tolerance == null) throw Error("Way replacement needs a replacement tolerance");
  return discoverWayReplacements(baseView, patchView, tolerance);
}
