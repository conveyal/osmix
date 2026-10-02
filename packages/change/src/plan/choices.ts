/**
 * Why each imported feature still waits for a decision, as one group per feature, so a review
 * of tens of thousands of features becomes a few group decisions (MP-M7).
 */
import type { OsmConflationCandidate } from "../types.ts";
import {
  agreeingPicks,
  choiceRivals,
  type Decidable,
  isDecidable,
  proposalDistance,
  winsByClearMargin,
} from "./automation.ts";
import type { MergePlan, PlanDecision, PlanProposal } from "./types.ts";

/**
 * Why a feature waits, most in need of a person first. A feature is in the group of its most
 * pressing waiting proposal:
 * - `removal`: removing an imported way (MP-R1).
 * - `individual`: a change of grade, the drivable network, travel restrictions, relations, a
 *   tagged point's context or protected tags.
 * - `replacement`: keeping imported ways in place of the base ways they trace (MP-R2).
 * - `bend`: a connection that bends more than 30°.
 * - `tie`: a choice no candidate can settle: none wins by a clear margin, or the one that does
 *   bends sharply or needs a closer look itself.
 * - `nearest`: a choice one candidate wins by a clear margin (MP-M6), and that candidate needs
 *   nothing else from a person.
 * - `routing-tags`: a copy of routing-affecting tags with no competing choice.
 * - `other`: anything else waiting, such as every proposal when automation is conservative.
 */
export const PLAN_CHOICE_GROUPS = [
  "removal",
  "individual",
  "replacement",
  "bend",
  "tie",
  "nearest",
  "routing-tags",
  "other",
] as const;
export type PlanChoiceGroup = (typeof PLAN_CHOICE_GROUPS)[number];

const INDIVIDUAL_REASONS = new Set([
  "grade-change",
  "drivable-network",
  "routing-family-conflict",
  "relation-member",
  "node-context-conflict",
  "protected-tag",
]);

/** A choice's winner can be picked for a person only if it needs nothing else from them. */
function canPick(proposal: PlanProposal) {
  return !proposal.reasons.some(
    (reason) => INDIVIDUAL_REASONS.has(reason) || reason === "bearing-mismatch",
  );
}

export interface PlanChoices {
  /** The group of each waiting proposal, by proposal ID. */
  proposals: Map<string, PlanChoiceGroup>;
  /** The group of each feature that needs a decision, by feature key. */
  features: Map<string, PlanChoiceGroup>;
  /** Features per group; they sum to the features that need a decision. */
  counts: Record<PlanChoiceGroup, number>;
}

/** Group every waiting proposal and every feature that needs a decision. */
export function planChoices(
  plan: MergePlan,
  candidates: ReadonlyMap<string, OsmConflationCandidate>,
): PlanChoices {
  const distance = proposalDistance(candidates);
  const waiting = (proposal: PlanProposal | undefined) => proposal?.effect === "needs-decision";
  const winners = new Set<string>();
  for (const proposal of plan.proposals.values()) {
    if (!waiting(proposal) || !isDecidable(proposal) || !canPick(proposal)) continue;
    const rivals = choiceRivals(proposal, plan.proposals);
    if (rivals.length > 0 && winsByClearMargin(proposal, rivals, distance)) {
      winners.add(proposal.id);
    }
  }
  const groupOf = (proposal: PlanProposal): PlanChoiceGroup => {
    if (proposal.kind === "remove-way") return "removal";
    if (proposal.reasons.some((reason) => INDIVIDUAL_REASONS.has(reason))) return "individual";
    if (proposal.kind === "replace-way") return "replacement";
    if (proposal.reasons.includes("bearing-mismatch")) return "bend";
    if (isDecidable(proposal)) {
      const rivals = choiceRivals(proposal, plan.proposals);
      if (rivals.length > 0) {
        const settled = winners.has(proposal.id) || rivals.some(({ id }) => winners.has(id));
        return settled ? "nearest" : "tie";
      }
      if (
        proposal.reasons.includes("many-to-one") ||
        proposal.reasons.includes("multiple-targets")
      ) {
        return "tie";
      }
      if (proposal.kind === "copy-tags" && proposal.reasons.includes("routing-property")) {
        return "routing-tags";
      }
    }
    return "other";
  };

  const proposals = new Map<string, PlanChoiceGroup>();
  const features = new Map<string, PlanChoiceGroup>();
  const counts = Object.fromEntries(PLAN_CHOICE_GROUPS.map((group) => [group, 0])) as Record<
    PlanChoiceGroup,
    number
  >;
  for (const feature of plan.features) {
    if (feature.outcome !== "needs-decision") continue;
    let best: PlanChoiceGroup | undefined;
    for (const id of feature.proposalIds) {
      const proposal = plan.proposals.get(id);
      if (!proposal || !waiting(proposal)) continue;
      const group = groupOf(proposal);
      proposals.set(id, group);
      if (!best || PLAN_CHOICE_GROUPS.indexOf(group) < PLAN_CHOICE_GROUPS.indexOf(best)) {
        best = group;
      }
    }
    if (!best) continue;
    features.set(feature.key, best);
    counts[best]++;
  }
  return { proposals, features, counts };
}

/**
 * A person's decisions that pick the clearly nearest candidate among `proposalIds`' choices:
 * include each winner and leave out its rivals (MP-M6's rule, chosen by a person). A choice
 * with no clear winner, or a person's decision already made, is left alone.
 */
export function pickNearestDecisions(
  plan: MergePlan,
  candidates: ReadonlyMap<string, OsmConflationCandidate>,
  proposalIds: Iterable<string>,
): PlanDecision[] {
  const distance = proposalDistance(candidates);
  const picks: Decidable[] = [];
  for (const id of proposalIds) {
    const proposal = plan.proposals.get(id);
    if (!isDecidable(proposal) || proposal.effect !== "needs-decision" || !canPick(proposal)) {
      continue;
    }
    const rivals = choiceRivals(proposal, plan.proposals);
    if (rivals.length > 0 && winsByClearMargin(proposal, rivals, distance)) picks.push(proposal);
  }
  const decisions = new Map<string, PlanDecision["action"]>();
  for (const pick of agreeingPicks(picks)) {
    decisions.set(pick.id, "accept");
    for (const rival of choiceRivals(pick, plan.proposals)) {
      if (rival.decision && !rival.automated) continue;
      decisions.set(rival.id, "reject");
    }
  }
  return [...decisions].map(([proposalId, action]) => ({ proposalId, action }));
}
