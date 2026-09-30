/**
 * Automation levels: decisions the planner makes on matching proposals that would otherwise wait
 * for a person, so a trusted import leaves only real judgment calls (MP-M6).
 *
 * A level only decides review proposals nobody has decided, and only when every reason the
 * proposal waits for is one the level trusts. It never decides a removal (MP-R1) or a blocked
 * proposal (MP-P3), and it never acts on a choice a person has already made.
 */
import type { OsmConflationCandidate } from "../types.ts";
import type { MatchingProposal, MergePlanAutomation, PlanProposal } from "./types.ts";

/**
 * One candidate must be at least this much nearer than every other it competes with: at most
 * half the other's distance, or this many meters nearer.
 */
const MARGIN_RATIO = 0.5;
const MARGIN_METERS = 0.5;

/** Review reasons that mean "choose one of several", which only a clear margin settles. */
const CHOICE_REASONS = new Set(["many-to-one", "multiple-targets"]);

/** Review reasons each level settles. */
const TRUSTED_REASONS: Record<Exclude<MergePlanAutomation, "conservative">, Set<string>> = {
  recommended: new Set(["many-to-one"]),
  aggressive: new Set(["many-to-one", "multiple-targets", "routing-property"]),
};

export type Decidable = MatchingProposal & { kind: "connect" | "copy-tags" };

export function isDecidable(proposal: PlanProposal | undefined): proposal is Decidable {
  return (
    proposal !== undefined &&
    (proposal.kind === "connect" || proposal.kind === "copy-tags") &&
    proposal.status !== "blocked"
  );
}

function decide(proposal: PlanProposal, action: "accept" | "reject") {
  proposal.decision = action;
  proposal.automated = true;
  proposal.effect = action === "accept" ? "applied" : "skipped";
}

/** The evidence distance of a matching proposal's candidate, NaN when unknown. */
export type ProposalDistance = (proposal: MatchingProposal) => number;

export function proposalDistance(
  candidates: ReadonlyMap<string, OsmConflationCandidate>,
): ProposalDistance {
  return (proposal) => candidates.get(proposal.candidateId)?.evidence.distanceMeters ?? Number.NaN;
}

/** The alternatives and competitors a proposal must be chosen over, excluding blocked ones. */
export function choiceRivals(
  proposal: MatchingProposal,
  proposals: ReadonlyMap<string, PlanProposal>,
): Decidable[] {
  return [...proposal.alternatives, ...proposal.competitors]
    .map((id) => proposals.get(id))
    .filter(isDecidable);
}

/**
 * Whether `proposal` is clearly the nearest of its rivals (MP-M6): at most half as far as each,
 * or at least 0.5 m nearer. A person's choice among them stands, and a rival they left out
 * still competes, so leaving out a winner never promotes the runner-up.
 */
export function winsByClearMargin(
  proposal: MatchingProposal,
  rivals: readonly MatchingProposal[],
  distance: ProposalDistance,
) {
  if (rivals.some((rival) => rival.decision === "accept" && !rival.automated)) return false;
  const own = distance(proposal);
  if (!Number.isFinite(own)) return false;
  return rivals.every((rival) => {
    const theirs = distance(rival);
    return (
      !Number.isFinite(theirs) || own <= theirs * MARGIN_RATIO || theirs - own >= MARGIN_METERS
    );
  });
}

/**
 * Picks whose source agrees with itself: copying to one target while connecting to another is
 * a conflict (MP-M5), so a source whose picks name different targets keeps none of them.
 */
export function agreeingPicks<T extends MatchingProposal>(picks: readonly T[]): T[] {
  const targets = new Map<string, Set<number>>();
  const key = ({ source }: MatchingProposal) => `${source.type}:${source.id}`;
  for (const pick of picks)
    targets.set(key(pick), (targets.get(key(pick)) ?? new Set()).add(pick.target.id));
  return picks.filter((pick) => targets.get(key(pick))!.size === 1);
}

/**
 * Decide the matching proposals `level` settles. `proposals` are the plan's proposals with each
 * person's decision already applied; `candidates` supply the evidence distances. Returns the
 * number of proposals decided.
 */
export function automateMatching(
  level: MergePlanAutomation,
  proposals: ReadonlyMap<string, PlanProposal>,
  candidates: ReadonlyMap<string, OsmConflationCandidate>,
): number {
  if (level === "conservative") return 0;
  const trusted = TRUSTED_REASONS[level];
  const distance = proposalDistance(candidates);

  const accepted: Decidable[] = [];
  for (const proposal of proposals.values()) {
    if (!isDecidable(proposal) || proposal.status !== "review" || proposal.decision) continue;
    if (!proposal.reasons.every((reason) => trusted.has(reason))) continue;
    const rivals = choiceRivals(proposal, proposals);
    if (rivals.length === 0) {
      // A choice with no linked rival to beat (tag copies onto one base point do not compete,
      // yet several sources claim it) is left for a person; otherwise the level trusts every
      // reason the proposal waits for.
      if (!proposal.reasons.some((reason) => CHOICE_REASONS.has(reason))) accepted.push(proposal);
      continue;
    }
    // Recommended settles only points of one imported way competing for one base point.
    if (
      level === "recommended" &&
      (proposal.alternatives.some((id) => isDecidable(proposals.get(id))) ||
        rivals.some((rival) => rival.feature !== proposal.feature))
    ) {
      continue;
    }
    if (winsByClearMargin(proposal, rivals, distance)) accepted.push(proposal);
  }

  let decided = 0;
  for (const proposal of agreeingPicks(accepted)) {
    decide(proposal, "accept");
    decided++;
    for (const rival of choiceRivals(proposal, proposals)) {
      if (rival.decision) continue;
      decide(rival, "reject");
      decided++;
    }
  }
  return decided;
}
