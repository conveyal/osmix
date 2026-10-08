import { Radio, RadioLabel, StatusDot, type StatusDotStatus, useTaskLock } from "@osmix/ui";
import { useAtomValue } from "jotai";
import type { PlanDecision, PlanProposal } from "osmix";
import { useId } from "react";

import {
  AUTOMATION_LABEL,
  PROPOSAL_KIND_LABEL,
  isDecidable,
  planReasonLabel,
  proposalStatusText,
} from "../lib/merge-plan-workflow";
import { planOverviewAtom, planPendingChoicesAtom } from "../state/merge-plan";

const EFFECT_DOT: Record<PlanProposal["effect"], StatusDotStatus> = {
  applied: "ok",
  skipped: "warn",
  blocked: "error",
  "needs-decision": "warn",
};

type Choice = PlanDecision["action"] | "rule";

/** What the proposal changes, in words: its kind and the base entity it involves. */
export function proposalTitle(proposal: PlanProposal) {
  const kind = PROPOSAL_KIND_LABEL[proposal.kind];
  if (proposal.kind === "replace-way") {
    const ids = proposal.replaces.map(({ id }) => id).join(", ");
    return proposal.replaces.length === 1 ? `Replace base way ${ids}` : `Replace base ways ${ids}`;
  }
  if ("target" in proposal)
    return `${kind} with base ${proposal.target.type} ${proposal.target.id}`;
  if ("ways" in proposal) return `${kind} with ${proposal.ways[1].type} ${proposal.ways[1].id}`;
  return kind;
}

/**
 * One proposal: what it does, whether it is in the plan and why, and the choice for it. An
 * automatic proposal is included unless left out; one that needs review waits for a choice; a
 * blocked one shows its reasons and takes no choice. A choice the automation level made shows
 * as its rule, which a person's choice replaces.
 */
export function PlanProposalActions({
  onDecide,
  proposal,
}: {
  onDecide: (
    proposalId: string,
    action: PlanDecision["action"] | null,
    excludes: readonly string[],
    together?: readonly string[],
  ) => unknown;
  proposal: PlanProposal;
}) {
  const taskLocked = useTaskLock();
  const automation = useAtomValue(planOverviewAtom)?.options.automation ?? "recommended";
  const pendingChoices = useAtomValue(planPendingChoicesAtom);
  const name = useId();
  const title = proposalTitle(proposal);
  const decidable = isDecidable(proposal) && proposal.status !== "blocked";
  // A choice not sent to the planner yet shows as chosen, marked as not applied.
  const pending = pendingChoices.has(proposal.id);
  const choice: Choice = pending
    ? (pendingChoices.get(proposal.id) ?? "rule")
    : proposal.automated
      ? "rule"
      : (proposal.decision ?? "rule");
  const automated = proposal.automated
    ? `${proposal.decision === "accept" ? "Include" : "Leave out"} (${AUTOMATION_LABEL[automation]})`
    : null;
  const choices: { value: Choice; label: string }[] =
    proposal.status === "automatic"
      ? [
          { value: "rule", label: "Include (automatic)" },
          { value: "reject", label: "Leave out" },
        ]
      : automated
        ? [
            { value: "rule", label: automated },
            {
              value: proposal.decision === "accept" ? "reject" : "accept",
              label: proposal.decision === "accept" ? "Leave out" : "Include",
            },
          ]
        : [
            { value: "rule", label: "Decide later" },
            { value: "accept", label: "Include" },
            { value: "reject", label: "Leave out" },
          ];
  const alternatives = "alternatives" in proposal ? proposal.alternatives.length : 0;
  const competitors = "competitors" in proposal ? proposal.competitors.length : 0;
  const excludes = [
    ...("competitors" in proposal ? [...proposal.alternatives, ...proposal.competitors] : []),
    ...(proposal.excludes ?? []),
  ];
  return (
    <div className="flex flex-col gap-1" data-proposal-id={proposal.id}>
      <div className="flex items-center gap-2">
        <StatusDot status={EFFECT_DOT[proposal.effect]} />
        <span className="font-medium">{title}</span>
      </div>
      <p className="text-muted-foreground">
        {proposalStatusText(proposal)}
        {proposal.automated ? ` · Decided by ${AUTOMATION_LABEL[automation]}` : null}
        {pending ? " · Choice not applied yet" : null}
      </p>
      {proposal.reasons.length > 0 ? (
        <ul className="list-disc pl-4 text-muted-foreground">
          {proposal.reasons.map((reason) => (
            <li key={reason}>{planReasonLabel(reason)}</li>
          ))}
        </ul>
      ) : null}
      {proposal.kind === "replace-way" && proposal.together.length > 0 ? (
        <p className="text-muted-foreground">
          Decided together with imported {proposal.together.length === 1 ? "way" : "ways"}{" "}
          {proposal.together.map(({ id }) => id).join(", ")}.
        </p>
      ) : null}
      {alternatives > 0 ? (
        <p className="text-muted-foreground">
          {alternatives.toLocaleString()} other {alternatives === 1 ? "target is" : "targets are"}{" "}
          possible; include at most one.
        </p>
      ) : null}
      {competitors > 0 && "target" in proposal ? (
        <p className="text-muted-foreground">
          {competitors.toLocaleString()} other imported{" "}
          {proposal.kind === "connect"
            ? `${competitors === 1 ? "point" : "points"} can also connect to base node ${proposal.target.id}`
            : `${competitors === 1 ? "feature" : "features"} can also change base way ${proposal.target.id}`}
          ; include at most one. Including this one leaves the others out.
        </p>
      ) : null}
      {decidable ? (
        <fieldset className="flex flex-wrap gap-x-3" aria-label={`Choice: ${title}`}>
          {choices.map((option) => (
            <RadioLabel key={option.value}>
              <Radio
                name={name}
                value={option.value}
                checked={choice === option.value}
                disabled={taskLocked}
                onChange={() =>
                  void onDecide(
                    proposal.id,
                    option.value === "rule" ? null : option.value,
                    excludes,
                    proposal.kind === "replace-way" ? proposal.set : [],
                  )
                }
              />
              {option.label}
            </RadioLabel>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}
