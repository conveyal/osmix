import {
  ActionButton,
  Alert,
  Button,
  EmptyState,
  NativeSelect,
  NativeSelectOption,
  Pager,
  SidebarSection,
  useTaskLock,
} from "@osmix/ui";
import { CheckCheckIcon, CheckIcon, LocateFixedIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { PLAN_CHOICE_GROUPS, type PlanChoiceGroup } from "osmix";
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
  CHOICE_GROUP_LABEL,
  FILTERABLE_KINDS,
  OUTCOME_LABEL,
  OUTCOMES,
  PROPOSAL_KIND_LABEL,
} from "../lib/merge-plan-workflow";
import { PlanFeatureRow } from "./plan-feature-row";

export const PLAN_PAGE_SIZE = 10;

const BULK_ACTIONS = [
  { action: "pick-nearest", icon: <LocateFixedIcon />, variant: "outline" },
  { action: "accept", icon: <CheckCheckIcon />, variant: "outline" },
  { action: "reject", icon: <XIcon />, variant: "outline" },
  { action: "clear", icon: <RotateCcwIcon />, variant: "ghost" },
] as const;

const BULK_LOADING_LABEL = {
  "pick-nearest": "Pick nearest",
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
  pending = null,
  preview,
}: {
  detail: MergePlanFeatureDetail | null;
  filter: MergePlanFilter;
  onBulk: (request: MergePlanBulkRequest) => unknown;
  onDecide: (
    proposalId: string,
    action: PlanDecision["action"] | null,
    excludes: readonly string[],
    together?: readonly string[],
  ) => unknown;
  onFilterChange: (filter: MergePlanFilter) => unknown;
  onPageChange: (page: number) => unknown;
  onSelect: (featureKey: string) => unknown;
  page: MergePlanPage;
  pageIndex: number;
  /**
   * Row choices not applied yet, which replan together: how many, and how to apply or discard
   * them. Choices for shown features wait until they are applied or discarded.
   */
  pending?: { count: number; onApply: () => unknown; onDiscard: () => unknown } | null;
  /** What each bulk choice would do; null while it loads. */
  preview: MergePlanBulkPreview | null;
}) {
  const taskLocked = useTaskLock();
  const outcomeId = useId();
  const kindId = useId();
  const groupId = useId();
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
          <div className="col-span-2 flex flex-col gap-1">
            <label htmlFor={groupId}>Waiting because</label>
            <NativeSelect
              className="w-full"
              id={groupId}
              value={filter.group ?? ""}
              disabled={taskLocked}
              onChange={(event) => {
                const group = event.target.value as PlanChoiceGroup | "";
                const { group: _group, ...rest } = filter;
                void onFilterChange(group ? { ...rest, group } : rest);
              }}
            >
              <NativeSelectOption value="">Any reason</NativeSelectOption>
              {PLAN_CHOICE_GROUPS.map((group) => (
                <NativeSelectOption key={group} value={group}>
                  {CHOICE_GROUP_LABEL[group]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choices for shown features">
          {BULK_ACTIONS.map(({ action, icon, variant }) => {
            const changed = preview?.[action].changed ?? 0;
            // Picking the nearest is offered only where a clear nearest exists.
            if (action === "pick-nearest" && changed === 0) return null;
            return (
              <ActionButton
                key={action}
                size="sm"
                variant={variant}
                icon={icon}
                disabled={preview === null || changed === 0 || pending !== null}
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
        {pending ? (
          <Alert role="status" className="flex flex-col gap-2">
            <p>
              {pending.count.toLocaleString()} {pending.count === 1 ? "choice" : "choices"} not
              applied yet. Make more, then apply them together; the plan updates once.
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionButton size="sm" icon={<CheckIcon />} onAction={async () => pending.onApply()}>
                Apply {pending.count.toLocaleString()} {pending.count === 1 ? "choice" : "choices"}
              </ActionButton>
              <Button
                size="sm"
                variant="ghost"
                disabled={taskLocked}
                onClick={() => void pending.onDiscard()}
              >
                Discard
              </Button>
            </div>
          </Alert>
        ) : null}
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
