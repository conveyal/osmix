import {
  ActionButton,
  EmptyState,
  NativeSelect,
  NativeSelectOption,
  Pager,
  SidebarSection,
  useTaskLock,
} from "@osmix/ui";
import { CheckCheckIcon, RotateCcwIcon, XIcon } from "lucide-react";
import type {
  MergePlanBulkPreview,
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
  bulkActionLabel,
  FILTERABLE_KINDS,
  OUTCOME_LABEL,
  OUTCOMES,
  PROPOSAL_KIND_LABEL,
} from "../lib/merge-plan-workflow";
import { PlanFeatureRow } from "./plan-feature-row";

export const PLAN_PAGE_SIZE = 10;

const BULK_ACTIONS = [
  { action: "accept", icon: <CheckCheckIcon />, variant: "outline" },
  { action: "reject", icon: <XIcon />, variant: "outline" },
  { action: "clear", icon: <RotateCcwIcon />, variant: "ghost" },
] as const;

const BULK_LOADING_LABEL = {
  accept: "Include shown",
  reject: "Leave out shown",
  clear: "Clear choices",
} as const;

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
  preview,
}: {
  detail: MergePlanFeatureDetail | null;
  filter: MergePlanFilter;
  onBulk: (request: MergePlanBulkRequest) => unknown;
  onDecide: (
    proposalId: string,
    action: PlanDecision["action"] | null,
    excludes: readonly string[],
  ) => unknown;
  onFilterChange: (filter: MergePlanFilter) => unknown;
  onPageChange: (page: number) => unknown;
  onSelect: (featureKey: string) => unknown;
  page: MergePlanPage;
  pageIndex: number;
  /** What each bulk choice would do; null while it loads. */
  preview: MergePlanBulkPreview | null;
}) {
  const taskLocked = useTaskLock();
  const outcomeId = useId();
  const kindId = useId();
  const shown = page.total.toLocaleString();
  return (
    <SidebarSection flush title="Imported features">
      <div className="flex flex-col gap-2 px-inset pb-inset">
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
          {BULK_ACTIONS.map(({ action, icon, variant }) => {
            const changed = preview?.[action].changed ?? 0;
            return (
              <ActionButton
                key={action}
                size="sm"
                variant={variant}
                icon={icon}
                disabled={preview === null || changed === 0}
                onAction={async () => onBulk({ action, filter })}
              >
                {preview === null ? BULK_LOADING_LABEL[action] : bulkActionLabel(action, changed)}
              </ActionButton>
            );
          })}
        </div>
        <p className="text-muted-foreground">
          Choices apply to the {shown} features shown and keep every choice already made.{" "}
          {preview && preview.accept.waiting > 0
            ? `After Include, ${preview.accept.waiting.toLocaleString()} still need their own choice: removals and choices between competing proposals. `
            : null}
          Blocked proposals never change.
        </p>
      </div>
      {page.features.length === 0 ? (
        <EmptyState className="border-t">No imported features match these filters</EmptyState>
      ) : (
        <div className="flex flex-col border-t">
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
        className="border-t px-inset py-2"
        label="Imported feature pages"
        page={pageIndex}
        pageCount={page.totalPages}
        disabled={taskLocked}
        onPageChange={(next) => void onPageChange(next)}
      />
    </SidebarSection>
  );
}
