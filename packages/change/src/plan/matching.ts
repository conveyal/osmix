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
import type {
  OsmConflationActionAssessment,
  OsmConflationCandidate,
  OsmConflationDecision,
  OsmConflationDiscovery,
} from "../types.ts";
import { entityToken, type PlanBuilder } from "./builder.ts";
import type { MergePlan, MergePlanOptions, PlanProposal } from "./types.ts";

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
): { discovery: OsmConflationDiscovery; matching: NonNullable<MergePlan["matching"]> } {
  if ("decisions" in options) {
    throw Error("Decide matching proposals with plan decisions, not matching.decisions");
  }
  const discovery = discoverPlannedConflationCandidates(base, planned, changeset.overlay, options);
  const byCandidate: CandidateProposals[] = [];
  const propose = (
    candidate: OsmConflationCandidate,
    kind: MatchingKind,
    assessment: OsmConflationActionAssessment | null | undefined,
  ) => {
    if (!assessment || assessment.status === "unmatched" || candidate.targetId == null) return;
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
      status: assessment.status,
      reasons: [...assessment.reasons],
    });
  };
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
  // Removal eligibility depends on which connections are accepted, so assess it last.
  const draft = matchingDecisions(byCandidate, (id) => builder.decisionFor(id));
  refreshConflationWayRemovalAssessments(base, planned, discovery, draft);
  for (const entry of byCandidate) {
    const removal = entry.candidate.wayRemoval;
    if (removal?.status === "review" || removal?.status === "blocked") {
      entry.remove = propose(entry.candidate, "remove-way", removal);
    }
  }
  linkAlternatives(byCandidate);

  const decisions = matchingDecisions(byCandidate);
  const outcome = applyPlannedConflation(changeset, base, planned, discovery, decisions);
  return { discovery, matching: { candidates: discovery.summary, outcome } };
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

function linkAlternatives(entries: readonly CandidateProposals[]) {
  for (const kind of ["connect", "copy", "remove"] as const) {
    const bySource = new Map<string, PlanProposal[]>();
    for (const entry of entries) {
      const proposal = entry[kind];
      if (!proposal || !("alternatives" in proposal)) continue;
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
}
