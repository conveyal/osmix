import { Button, Item, ItemContent, ItemTitle, SectionTitle } from "@osmix/ui";
import { MapPinIcon } from "lucide-react";
import type { MergePlanFeatureDetail, MergePlanFeatureView, PlanDecision } from "osmix";

import {
  OUTCOME_LABEL,
  isDecidable,
  planFeatureReference,
  planFeatureTitle,
} from "../lib/merge-plan-workflow";
import { CandidateEvidence } from "./conflation-candidate-evidence";
import { matchedPair, PlanProposalActions, proposalTitle } from "./plan-proposal-actions";

/**
 * One imported feature in the review: its outcome, the choices it needs, and, once opened,
 * the evidence behind its matches. A way's vertices are part of it.
 */
export function PlanFeatureRow({
  detail,
  feature,
  onDecide,
  onSelect,
}: {
  /** The evidence, when this feature is the one open. */
  detail: MergePlanFeatureDetail | null;
  feature: MergePlanFeatureView;
  onDecide: (
    proposalId: string,
    action: PlanDecision["action"] | null,
    excludes: readonly string[],
    together?: readonly string[],
  ) => unknown;
  onSelect: (featureKey: string) => unknown;
}) {
  const reference = planFeatureReference(feature);
  const decisions = feature.proposals.filter(isDecidable);
  const direct = feature.proposals.filter((proposal) => !isDecidable(proposal));
  // Proposals for the same pair (a connection and a copy) share one candidate's evidence.
  const evidence = new Map(
    Object.entries(detail?.candidates ?? {}).map(([proposalId, candidate]) => {
      const proposal = feature.proposals.find(({ id }) => id === proposalId);
      const pair = (proposal && matchedPair(proposal)) ?? proposalId;
      return [candidate.id, { candidate, pair }] as const;
    }),
  );
  return (
    <Item
      role="region"
      variant="row"
      aria-label={reference}
      aria-current={detail ? "true" : undefined}
      data-outcome={feature.outcome}
      className="flex-col items-stretch py-inset"
    >
      <ItemContent>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <ItemTitle className="truncate">{planFeatureTitle(feature)}</ItemTitle>
            <span className="font-mono text-muted-foreground">{reference}</span>
          </div>
          <span className="font-semibold">{OUTCOME_LABEL[feature.outcome]}</span>
        </div>
        {direct.length > 0 ? (
          <p className="text-muted-foreground">{direct.map(proposalTitle).join("; ")}</p>
        ) : null}
        {decisions.map((proposal) => (
          <PlanProposalActions key={proposal.id} proposal={proposal} onDecide={onDecide} />
        ))}
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={Boolean(detail)}
          onClick={() => void onSelect(feature.key)}
        >
          <MapPinIcon aria-hidden="true" />
          {detail ? "Showing on map" : "Show on map and evidence"}
        </Button>
        {[...evidence.values()].map(({ candidate, pair }) => (
          <section key={candidate.id} aria-label={`Evidence: ${pair}`}>
            <SectionTitle>Evidence: {pair}</SectionTitle>
            <CandidateEvidence candidate={candidate} />
          </section>
        ))}
      </ItemContent>
    </Item>
  );
}
