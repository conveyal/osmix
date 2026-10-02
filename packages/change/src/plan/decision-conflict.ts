/**
 * Included proposals that exclude each other (MP-M5): alternatives for one imported feature,
 * competitors from different features for one base target, and proposals of other kinds a way
 * replacement leaves out (MP-R2).
 */
import type { MatchingProposal, PlanDecision, PlanProposal } from "./types.ts";

/**
 * Decisions that include two proposals which cannot both apply: alternatives for one imported
 * feature, or competitors from different features for one base target (MP-M5). The plan is
 * left unchanged. `proposalIds` names the pair.
 */
export class MergePlanDecisionConflictError extends Error {
  override name = "MergePlanDecisionConflictError";
  readonly proposalIds: [string, string];
  constructor(message: string, proposalIds: [string, string]) {
    super(message);
    this.proposalIds = proposalIds;
  }
}

const TOKEN_TYPE: Record<string, string> = { n: "node", w: "way", r: "relation" };

/**
 * The imported source of a matching proposal in words, from its ID's original patch token
 * (`connect:n-5>n12` → "imported node -5"), with the feature it belongs to when that is a
 * way it is a vertex of: "imported node -5 (on imported way -9)".
 */
function sourceReference(proposal: MatchingProposal) {
  const token = proposal.id.slice(proposal.id.indexOf(":") + 1, proposal.id.indexOf(">"));
  const type = TOKEN_TYPE[token.charAt(0)] ?? proposal.source.type;
  const source = `imported ${type} ${token.slice(1)}`;
  const [featureType, featureId] = proposal.feature.split(":");
  return featureType === type ? source : `${source} (on imported ${featureType} ${featureId})`;
}

/** The first pair of included proposals that cannot both apply, as an error, or `null`. */
export function findDecisionConflict(
  proposals: ReadonlyMap<string, PlanProposal>,
  decisions: readonly PlanDecision[],
) {
  // A blocked proposal never applies, so including it excludes nothing.
  const included = new Set(
    decisions
      .filter(({ action, proposalId }) => {
        return action === "accept" && proposals.get(proposalId)?.status !== "blocked";
      })
      .map(({ proposalId }) => proposalId),
  );
  for (const id of [...included].sort()) {
    const proposal = proposals.get(id);
    const excluded = proposal?.excludes?.find((other) => other > id && included.has(other));
    if (excluded) {
      return new MergePlanDecisionConflictError(
        `Both ${id} and ${excluded} are included, but they cannot both apply: including one ` +
          `leaves the other out. Include at most one of them.`,
        [id, excluded],
      );
    }
    if (!proposal || !("competitors" in proposal)) continue;
    const alternative = proposal.alternatives.find((other) => other > id && included.has(other));
    if (alternative) {
      const who = sourceReference(proposal);
      return new MergePlanDecisionConflictError(
        `Both ${id} and ${alternative} are included, but ${who} can match only one base ` +
          `feature for this action. Include at most one of them.`,
        [id, alternative],
      );
    }
    const competitor = proposal.competitors.find((other) => other > id && included.has(other));
    if (competitor) {
      const other = proposals.get(competitor) as MatchingProposal;
      const target = proposal.target;
      const what =
        proposal.kind === "connect"
          ? `connect to base node ${target.id}, which takes one connection`
          : `change base way ${target.id}, which takes one imported way's copy or removal`;
      return new MergePlanDecisionConflictError(
        `${capitalize(sourceReference(proposal))} and ` +
          `${sourceReference(other)} would both ${what}. Include at most one: ` +
          `${id} or ${competitor}.`,
        [id, competitor],
      );
    }
  }
  return null;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
