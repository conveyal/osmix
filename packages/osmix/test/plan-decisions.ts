import {
  type MergePlanOptions,
  type OsmConflationDecision,
  type OsmConflationOutcomeReport,
  type PlanDecision,
  planMerge,
} from "@osmix/change";
import type { Osm } from "@osmix/core";

import type { MergePlanOverview } from "../src/index.ts";
import type { OsmixWorker } from "../src/worker.ts";

/**
 * Plan options with matching decisions written as candidate decisions, the form the scenario
 * and worker tests describe. Each becomes a decision on the proposals of its candidate.
 */
export function withMatchingDecisions(
  base: Osm,
  patch: Osm,
  options: MergePlanOptions,
  decisions: readonly OsmConflationDecision[],
): MergePlanOptions {
  if (decisions.length === 0) return options;
  const plan = planMerge(base, patch, options, () => {});
  const byCandidate = new Map(decisions.map((decision) => [decision.candidateId, decision]));
  const known = new Set<string>();
  const result: PlanDecision[] = [];
  for (const proposal of plan.proposals.values()) {
    if (!("candidateId" in proposal)) continue;
    known.add(proposal.candidateId);
    const decision = byCandidate.get(proposal.candidateId);
    if (!decision) continue;
    const selected =
      decision.action === "accept" &&
      (proposal.kind === "connect"
        ? (decision.attachNetwork ?? true)
        : proposal.kind === "copy-tags"
          ? (decision.transferProperties ?? true)
          : decision.removeWay === true);
    if (proposal.kind === "remove-way" && !selected) continue;
    result.push({ proposalId: proposal.id, action: selected ? "accept" : "reject" });
  }
  for (const id of byCandidate.keys()) {
    if (!known.has(id)) throw Error(`Unknown conflation candidate: ${id}`);
  }
  return { ...options, decisions: result };
}

const ALL = Number.MAX_SAFE_INTEGER;

/**
 * The complete matching outcome of `overview`, read back from the worker's pages: the report
 * the overview summarizes, for tests that assert on its feature and tag lists.
 */
export function fullMatchingOutcome(
  worker: Pick<OsmixWorker, "getMergeMatchingPage" | "getMergeUncopiedTagPage">,
  baseId: string,
  overview: MergePlanOverview,
): OsmConflationOutcomeReport {
  const outcome = overview.matching?.outcome;
  if (!outcome) throw Error("Expected a matching outcome");
  const { tags, wayRemovalFeatures: _, ...rest } = outcome;
  return {
    ...rest,
    features: worker.getMergeMatchingPage(baseId, "all", 0, ALL).features,
    tags: tags.map(({ uncopiedFeatures: _count, ...tag }) => ({
      ...tag,
      uncopied: worker.getMergeUncopiedTagPage(baseId, tag.key, 0, ALL).features,
    })),
  };
}
