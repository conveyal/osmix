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

type Decidable = MatchingProposal & { kind: "connect" | "copy-tags" };

function isDecidable(proposal: PlanProposal | undefined): proposal is Decidable {
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
  const distance = (proposal: MatchingProposal) =>
    candidates.get(proposal.candidateId)?.evidence.distanceMeters ?? Number.NaN;
  const others = (proposal: MatchingProposal) =>
    [...proposal.alternatives, ...proposal.competitors]
      .map((id) => proposals.get(id))
      .filter(isDecidable);

  const accepted: Decidable[] = [];
  for (const proposal of proposals.values()) {
    if (!isDecidable(proposal) || proposal.status !== "review" || proposal.decision) continue;
    if (!proposal.reasons.every((reason) => trusted.has(reason))) continue;
    const rivals = others(proposal);
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
    // A person's choice in the group stands; a rival they left out still counts as competition.
    if (rivals.some((rival) => rival.decision === "accept" && !rival.automated)) continue;
    const own = distance(proposal);
    if (!Number.isFinite(own)) continue;
    const clear = rivals.every((rival) => {
      const theirs = distance(rival);
      return (
        !Number.isFinite(theirs) || own <= theirs * MARGIN_RATIO || theirs - own >= MARGIN_METERS
      );
    });
    if (clear) accepted.push(proposal);
  }

  // Copying to one target while connecting to another is a conflict (MP-M5): keep a source's
  // picks only when they agree on the target.
  const targets = new Map<string, Set<number>>();
  for (const proposal of accepted) {
    const key = `${proposal.source.type}:${proposal.source.id}`;
    targets.set(key, (targets.get(key) ?? new Set()).add(proposal.target.id));
  }
  let decided = 0;
  for (const proposal of accepted) {
    if (targets.get(`${proposal.source.type}:${proposal.source.id}`)!.size > 1) continue;
    decide(proposal, "accept");
    decided++;
    for (const rival of others(proposal)) {
      if (rival.decision) continue;
      decide(rival, "reject");
      decided++;
    }
  }
  return decided;
}
