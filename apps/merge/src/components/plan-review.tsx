import {
  ActionButton,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  NativeSelect,
  NativeSelectOption,
  Pager,
  useTaskLock,
} from "@osmix/ui";
import { CheckCheckIcon, RotateCcwIcon, XIcon } from "lucide-react";
import type {
  MergePlanBulkRequest,
  MergePlanFeatureDetail,
  MergePlanFilter,
  MergePlanPage,
  PlanDecision,
  PlanOutcome,
  PlanProposal,
} from "osmix";
import { useId } from "react";

import {
  FILTERABLE_KINDS,
  OUTCOME_LABEL,
  OUTCOMES,
  PROPOSAL_KIND_LABEL,
} from "../lib/merge-plan-workflow";
import { PlanFeatureRow } from "./plan-feature-row";

export const PLAN_PAGE_SIZE = 10;

/**
 * The plan, one row per imported feature: filters by outcome and proposal kind, choices for
 * everything the filter shows, and the paged rows themselves.
 */
export function PlanReview({
  detail,
  filter,
  onBulk,
  onDecide,
  onFilterChange,
  onPageChange,
  onSelect,
  page,
  pageIndex,
}: {
  detail: MergePlanFeatureDetail | null;
  filter: MergePlanFilter;
  onBulk: (request: MergePlanBulkRequest) => unknown;
  onDecide: (proposalId: string, action: PlanDecision["action"] | null) => unknown;
  onFilterChange: (filter: MergePlanFilter) => unknown;
  onPageChange: (page: number) => unknown;
  onSelect: (featureKey: string) => unknown;
  page: MergePlanPage;
  pageIndex: number;
}) {
  const taskLocked = useTaskLock();
  const outcomeId = useId();
  const kindId = useId();
  const shown = page.total.toLocaleString();
  return (
    <Card role="region" aria-labelledby="plan-review-title">
      <CardHeader id="plan-review-title">Imported features</CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={outcomeId}>Outcome</label>
            <NativeSelect
              className="w-full"
              id={outcomeId}
              value={filter.outcome ?? ""}
              disabled={taskLocked}
              onChange={(event) => {
                const outcome = event.target.value as PlanOutcome | "";
                const { outcome: _outcome, ...rest } = filter;
                void onFilterChange(outcome ? { ...rest, outcome } : rest);
              }}
            >
              <NativeSelectOption value="">All outcomes</NativeSelectOption>
              {OUTCOMES.map((outcome) => (
                <NativeSelectOption key={outcome} value={outcome}>
                  {OUTCOME_LABEL[outcome]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={kindId}>Proposal</label>
            <NativeSelect
              className="w-full"
              id={kindId}
              value={filter.kind ?? ""}
              disabled={taskLocked}
              onChange={(event) => {
                const kind = event.target.value as PlanProposal["kind"] | "";
                const { kind: _kind, ...rest } = filter;
                void onFilterChange(kind ? { ...rest, kind } : rest);
              }}
            >
              <NativeSelectOption value="">All proposals</NativeSelectOption>
              {FILTERABLE_KINDS.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {PROPOSAL_KIND_LABEL[kind]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choices for shown features">
          <ActionButton
            size="sm"
            variant="outline"
            icon={<CheckCheckIcon />}
            onAction={async () => onBulk({ action: "accept", filter })}
          >
            Include all shown
          </ActionButton>
          <ActionButton
            size="sm"
            variant="outline"
            icon={<XIcon />}
            onAction={async () => onBulk({ action: "reject", filter })}
          >
            Leave out all shown
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            icon={<RotateCcwIcon />}
            onAction={async () => onBulk({ action: "clear", filter })}
          >
            Clear choices
          </ActionButton>
        </div>
        <p className="text-muted-foreground">
          Choices apply to the {shown} features shown. Include applies to proposals that need
          review; a proposal with alternatives needs its own choice. Blocked proposals never change.
        </p>
        {page.features.length === 0 ? (
          <EmptyState>No imported features match these filters</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {page.features.map((feature) => (
              <PlanFeatureRow
                key={feature.key}
                feature={feature}
                detail={detail?.key === feature.key ? detail : null}
                onDecide={onDecide}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
        <Pager
          label="Imported feature pages"
          page={pageIndex}
          pageCount={page.totalPages}
          disabled={taskLocked}
          onPageChange={(next) => void onPageChange(next)}
        />
      </CardContent>
    </Card>
  );
}
