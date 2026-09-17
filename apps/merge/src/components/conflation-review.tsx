import {
  cn,
  ActionButton,
  useAction,
  InfoTooltip,
  EmptyState,
  SectionTitle,
  StatusDot,
  type StatusDotStatus,
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  Checkbox,
  CheckboxLabel,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@osmix/ui";
import { useAtom } from "jotai";
import { LocateFixedIcon } from "lucide-react";
import type {
  Osm,
  OsmConflationBulkAction,
  OsmConflationBulkDecisionPreview,
  OsmConflationBulkDecisionRequest,
  OsmConflationCandidateFilter,
  OsmConflationCandidateView,
  OsmConflationDecision,
  OsmConflationEffectiveStatus,
  OsmConflationPage,
  OsmConflationReasonCode,
  OsmConflationSummary,
} from "osmix";
import {
  buildConflationActionDecision,
  conflationEffectiveStatus,
  resolveConflationActions,
} from "osmix";
import { useEffect, useId, useState } from "react";

import { useMap } from "../hooks/map";
import { comparisonBounds, createConflationComparison } from "../lib/conflation-comparison";
import { conflationBulkActionCopy } from "../lib/conflation-workflow";
import { conflationComparisonAtom } from "../state/conflation";
import { CandidateEvidence, conflationDistanceLabel } from "./conflation-candidate-evidence";
import {
  ConflationComparisonEvidence,
  ConflationComparisonLegend,
} from "./conflation-comparison-evidence";
import { WayRemovalDetails } from "./conflation-way-removal";

export { CandidateEvidence } from "./conflation-candidate-evidence";

const REASON_CODES = [
  "bearing-mismatch",
  "drivable-network",
  "exact-match",
  "feature-type-conflict",
  "geometry-mismatch",
  "grade-conflict",
  "length-mismatch",
  "many-to-one",
  "multiple-targets",
  "no-transferable-properties",
  "node-context-conflict",
  "non-routing-target",
  "protected-tag",
  "relation-member",
  "routing-family-conflict",
  "routing-property",
  "same-id",
  "unsupported-way-chain",
  "would-collapse-way",
  "way-removal-connection-required",
  "way-removal-topology-conflict",
  "way-removal-routing-conflict",
  "way-removal-relation-member",
  "way-removal-unsupported",
] as const satisfies readonly OsmConflationReasonCode[];

const STATUS_DOT: Record<OsmConflationEffectiveStatus, StatusDotStatus> = {
  accepted: "ok",
  automatic: "ok",
  blocked: "error",
  rejected: "warn",
  review: "warn",
  unmatched: "error",
};

const STATUS_LABEL: Record<OsmConflationEffectiveStatus, string> = {
  accepted: "Scheduled",
  automatic: "Scheduled automatically",
  blocked: "Blocked",
  rejected: "Skipped",
  review: "Needs review",
  unmatched: "Unmatched",
};

const STATUS_HELP: Record<OsmConflationEffectiveStatus, string> = {
  accepted: "your selected matching actions are scheduled for the next preview",
  automatic:
    "matching rules scheduled at least one action for the next preview; nothing has been applied yet",
  blocked: "no enabled action can run; accepting cannot override a blocked action",
  rejected: "no matching actions are scheduled; ordinary imported additions are kept",
  review: "at least one action needs a decision; check the scheduled actions shown on each row",
  unmatched: "no compatible base target was found",
};

const REASON_LABEL: Record<OsmConflationReasonCode, string> = {
  "bearing-mismatch": "Direction does not align",
  "drivable-network": "Drivable network requires review",
  "exact-match": "Handled by exact reconciliation",
  "feature-type-conflict": "Feature classifications conflict",
  "geometry-mismatch": "Geometry differs",
  "grade-conflict": "Features are on incompatible levels",
  "length-mismatch": "Lengths differ",
  "many-to-one": "Multiple imported features share one base target",
  "multiple-targets": "Multiple possible base targets",
  "no-transferable-properties": "No selected attributes differ",
  "node-context-conflict": "Connected paths have incompatible context",
  "non-routing-target": "Base target is not routable",
  "protected-tag": "Protected structural attribute differs",
  "relation-member": "Feature belongs to an OSM relation",
  "routing-family-conflict": "Allowed travel is incompatible",
  "routing-property": "Attribute affects travel and requires review",
  "same-id": "Handled as a same-ID update",
  "unsupported-way-chain": "Matching one feature to several paths is unsupported",
  "would-collapse-way": "Connection would collapse a path",
  "way-removal-connection-required": "Select the required branch connections before removal",
  "way-removal-topology-conflict": "Removal would change required network connections",
  "way-removal-routing-conflict": "Retained way does not have equivalent travel meaning",
  "way-removal-relation-member": "Related OSM relations prevent removal",
  "way-removal-unsupported": "A supported equivalent way is required for removal",
};

export function conflationStatusLabel(status: OsmConflationEffectiveStatus) {
  return STATUS_LABEL[status];
}

export function conflationReasonLabel(reason: OsmConflationReasonCode) {
  return REASON_LABEL[reason];
}

export function conflationCandidateTitle(candidate: OsmConflationCandidateView) {
  const target =
    candidate.targetId == null
      ? "No compatible base target"
      : `Base ${candidate.entityType} ${candidate.targetId}`;
  return `Imported ${candidate.entityType} ${candidate.sourceId} → ${target}`;
}

export interface ConflationReviewProps {
  base: Osm;
  patch: Osm;
  summary: OsmConflationSummary;
  page: OsmConflationPage;
  filter: OsmConflationCandidateFilter;
  isFilterPending: boolean;
  allowWayRemoval?: boolean;
  onDecision: (decision: OsmConflationDecision) => Promise<void>;
  onResetDecision: (candidateId: string) => Promise<void>;
  onLeaveUnmatched: (
    source: Pick<OsmConflationCandidateView, "entityType" | "sourceId">,
  ) => Promise<void>;
  onBulkDecision: (request: OsmConflationBulkDecisionRequest) => Promise<void>;
  onFilterChange: (filter: OsmConflationCandidateFilter) => Promise<void>;
  onPageChange: (page: number) => Promise<void>;
}

function effectiveStatus(candidate: OsmConflationCandidateView) {
  return conflationEffectiveStatus(candidate, candidate.decision ? [candidate.decision] : []);
}

function SummaryTable({ summary }: { summary: OsmConflationSummary }) {
  return (
    <Table>
      <TableBody>
        {(
          ["total", "accepted", "automatic", "review", "blocked", "unmatched", "rejected"] as const
        ).map((key) => (
          <TableRow key={key}>
            <TableCell>{key === "total" ? "Total" : conflationStatusLabel(key)}</TableCell>
            <TableCell>{summary[key].toLocaleString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ConflationStatusLegend() {
  return (
    <InfoTooltip label="About candidate statuses" side="bottom" align="end">
      <div className="grid gap-1">
        <p>
          Overall status summarizes the proposed match. Each matching action is assessed
          independently. Review reasons never lift a safety block. An eligible action can still run
          while another action remains blocked. Removing an imported way is never automatic.
        </p>
        {(["automatic", "review", "blocked", "unmatched", "accepted", "rejected"] as const).map(
          (status) => (
            <p key={status}>
              <span className="font-bold">{conflationStatusLabel(status)}:</span>{" "}
              {STATUS_HELP[status]}.
            </p>
          ),
        )}
      </div>
    </InfoTooltip>
  );
}

const MATCHING_ACTIONS = [
  {
    action: "transfer-properties",
    assessment: "propertyTransfer",
    selected: "transferProperties",
    label: "Copy tags",
  },
  {
    action: "attach-network",
    assessment: "networkAttachment",
    selected: "attachNetwork",
    label: "Connect network",
  },
  {
    action: "remove-way",
    assessment: "wayRemoval",
    selected: "removeWay",
    label: "Remove imported way",
  },
] as const;

const REVIEW_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-[CanvasText] forced-colors:focus-visible:outline-offset-2";

function featureLabel(entityType: "node" | "way") {
  return entityType === "node" ? "point" : "line or area";
}

function actionStatus(
  candidate: OsmConflationCandidateView,
  action: (typeof MATCHING_ACTIONS)[number],
) {
  const assessment = candidate[action.assessment];
  if (!assessment) return "Unavailable";
  if (assessment.status === "blocked") return "Blocked";
  if (assessment.status === "unmatched") return "Unavailable";
  const scheduled = resolveConflationActions(candidate, candidate.decision)[action.selected];
  if (scheduled) return candidate.decision ? "Scheduled" : "Scheduled automatically";
  return "Not selected";
}

export function CandidateActionStatuses({ candidate }: { candidate: OsmConflationCandidateView }) {
  return (
    <div
      className="flex flex-wrap gap-x-3 text-muted-foreground"
      role="group"
      aria-label="Scheduled matching actions"
      aria-live="polite"
    >
      {MATCHING_ACTIONS.filter((action) => candidate[action.assessment]).map((action) => (
        <span key={action.action}>
          {action.label}:{" "}
          <span className="font-bold text-foreground">{actionStatus(candidate, action)}</span>
        </span>
      ))}
    </div>
  );
}

const BULK_ACTIONS = ["transfer-properties", "attach-network", "reject"] as const;

function BulkPreviewTable({ preview }: { preview: OsmConflationBulkDecisionPreview }) {
  const rows = [
    ["filtered matches", preview.filteredCandidates],
    ["will change", preview.changedCandidates],
    ["eligible", preview.eligibleCandidates],
    ["automatic", preview.automaticCandidates],
    ["review", preview.reviewCandidates],
    ["blocked, ambiguous, or ineligible skipped", preview.skippedCandidates],
    ["existing decisions replaced", preview.overriddenDecisions],
  ] as const;
  return (
    <Table>
      <TableBody>
        {rows.map(([label, count]) => (
          <TableRow key={label}>
            <TableCell className="whitespace-normal break-words">{label}</TableCell>
            <TableCell>{count.toLocaleString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ConflationBulkActions({
  bulkActions,
  disabled = false,
  filter,
  onBulkDecision,
}: {
  bulkActions: OsmConflationPage["bulkActions"];
  disabled?: boolean;
  filter: OsmConflationCandidateFilter;
  onBulkDecision: (request: OsmConflationBulkDecisionRequest) => Promise<void>;
}) {
  const [selectedAction, setSelectedAction] = useState<OsmConflationBulkAction | null>(null);
  const selectedPreview = selectedAction ? bulkActions[selectedAction] : null;
  const selectedCopy = selectedAction ? conflationBulkActionCopy(selectedAction) : null;

  return (
    <>
      <div className="flex flex-col gap-2 border-b bg-muted/50 p-2">
        <SectionTitle>
          Bulk decisions
          <InfoTooltip label="About bulk decisions" side="right" align="start">
            Bulk choices affect every match in the current filters across all pages. Automatic
            actions are already scheduled; preview changes before applying them.
          </InfoTooltip>
        </SectionTitle>
        <div className="flex flex-wrap gap-1">
          {BULK_ACTIONS.map((action) => {
            const preview = bulkActions[action];
            const copy = conflationBulkActionCopy(action);
            return (
              <Button
                key={action}
                disabled={disabled || preview.changedCandidates === 0}
                size="sm"
                variant={action === "reject" ? "destructive" : "outline"}
                onClick={() => setSelectedAction(action)}
              >
                {copy.buttonLabel} ({preview.changedCandidates.toLocaleString()})
              </Button>
            );
          })}
        </div>
      </div>

      <Dialog
        open={selectedAction !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedAction(null);
        }}
      >
        {selectedAction && selectedPreview && selectedCopy ? (
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{selectedCopy.title}</DialogTitle>
              <DialogDescription>
                {selectedCopy.description} This applies across every filtered page.
              </DialogDescription>
            </DialogHeader>
            <BulkPreviewTable preview={selectedPreview} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedAction(null)}>
                Cancel
              </Button>
              <ActionButton
                disabled={disabled}
                variant={selectedAction === "reject" ? "destructive" : "default"}
                onAction={async () => {
                  await onBulkDecision({ action: selectedAction, filter: { ...filter } });
                  setSelectedAction(null);
                }}
              >
                {selectedCopy.confirmLabel} ({selectedPreview.changedCandidates.toLocaleString()})
              </ActionButton>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

export function CandidateActions({
  candidate,
  onDecision,
  onResetDecision,
  showSkip = true,
  onReviewConnection,
  allowWayRemoval = false,
}: {
  candidate: OsmConflationCandidateView;
  onDecision: (decision: OsmConflationDecision) => Promise<void>;
  onResetDecision?: (candidateId: string) => Promise<void>;
  showSkip?: boolean;
  onReviewConnection?: (sourceNodeId: number) => Promise<void>;
  allowWayRemoval?: boolean;
}) {
  const { isPending, runAction } = useAction();
  const descriptionId = useId();
  const scheduled = resolveConflationActions(candidate, candidate.decision);
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-2 border-t p-2"
      aria-busy={isPending}
      aria-disabled={isPending ? true : undefined}
      aria-label={`Matching actions for imported ${candidate.entityType} ${candidate.sourceId}`}
      aria-describedby={descriptionId}
    >
      <p id={descriptionId} className="text-muted-foreground">
        Choose actions for the next preview. Each choice preserves the others; the dataset changes
        only when applied.
      </p>
      {MATCHING_ACTIONS.map((action) => {
        const assessment = candidate[action.assessment];
        if (!assessment) return null;
        const eligible =
          assessment.status !== "blocked" &&
          assessment.status !== "unmatched" &&
          (action.assessment !== "propertyTransfer" || candidate.evidence.tagDiff.length > 0);
        const reasons = assessment.reasons.map(conflationReasonLabel).join(", ");
        const helpId = `${descriptionId}-${action.action}`;
        return (
          <div key={action.action} className="flex flex-col gap-1">
            <CheckboxLabel className="min-h-8">
              <Checkbox
                checked={Boolean(scheduled[action.selected])}
                disabled={!eligible}
                {...(eligible && isPending ? { "aria-disabled": true } : {})}
                className={REVIEW_FOCUS}
                aria-describedby={`${descriptionId}${!eligible ? ` ${helpId}` : ""}${action.action === "remove-way" ? ` ${helpId}-removal` : ""}`}
                onCheckedChange={(checked) => {
                  // A temporary native disabled state would discard keyboard focus.
                  if (isPending) return;
                  runAction(() =>
                    onDecision(
                      buildConflationActionDecision(
                        candidate,
                        candidate.decision,
                        action.action,
                        checked,
                      ),
                    ),
                  );
                }}
              />
              {action.label}
            </CheckboxLabel>
            {!eligible ? (
              <p id={helpId} className="text-muted-foreground">
                {actionStatus(candidate, action)}: {reasons || "No eligible matching action"}.
              </p>
            ) : null}
            {allowWayRemoval &&
            action.action === "attach-network" &&
            eligible &&
            scheduled.attachNetwork &&
            candidate.decision?.attachNetwork !== true ? (
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground">
                  This connection is scheduled. Confirm it explicitly if an imported-way removal
                  depends on it.
                </p>
                <ActionButton
                  size="sm"
                  variant="outline"
                  className="h-auto min-h-8 max-w-full whitespace-normal"
                  onAction={() =>
                    onDecision(
                      buildConflationActionDecision(
                        candidate,
                        candidate.decision,
                        "attach-network",
                        true,
                      ),
                    )
                  }
                >
                  Confirm connection for removal
                </ActionButton>
              </div>
            ) : null}
            {action.action === "remove-way" ? (
              <div className="flex min-w-0 flex-col gap-2 border-l-2 border-destructive/60 pl-2">
                <p id={`${helpId}-removal`} className="text-muted-foreground">
                  Separate, explicit choice. Review the retained counterpart, connections, and
                  orphan-point cleanup below before applying. Removal is never selected
                  automatically.
                </p>
                {candidate.wayRemoval?.preview ? (
                  <WayRemovalDetails
                    preview={candidate.wayRemoval.preview}
                    onReviewConnection={onReviewConnection}
                  />
                ) : (
                  <p>No verified removal plan is available. Keep this imported way.</p>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      {!scheduled.transferProperties && !scheduled.attachNetwork && !scheduled.removeWay ? (
        <p className="text-muted-foreground">
          No matching actions scheduled. Ordinary imported additions are kept.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {showSkip ? (
          <ActionButton
            size="sm"
            variant="ghost"
            disabled={effectiveStatus(candidate) === "rejected"}
            onAction={() => onDecision({ candidateId: candidate.id, action: "reject" })}
          >
            Skip match
          </ActionButton>
        ) : null}
        {candidate.decision && onResetDecision ? (
          <ActionButton size="sm" variant="outline" onAction={() => onResetDecision(candidate.id)}>
            Use automatic choices
          </ActionButton>
        ) : null}
      </div>
    </fieldset>
  );
}

export function ConflationResultsHeader({
  isFilterPending,
  totalCandidates,
}: {
  isFilterPending: boolean;
  totalCandidates: number;
}) {
  return (
    <CardHeader className={cn(isFilterPending && "bg-warning/10")}>
      Filtered matches ({totalCandidates.toLocaleString()}
      {isFilterPending ? ", stale" : ""})
      {isFilterPending ? (
        <CardAction className="text-warning" aria-live="polite">
          <Spinner />
          Updating filters…
        </CardAction>
      ) : null}
    </CardHeader>
  );
}

type SelectionContext = {
  base: Osm;
  patch: Osm;
  page: number;
  candidateIds: string;
  filterKey: string;
  isFilterPending: boolean;
};

function sameSelectionContext(a: SelectionContext, b: SelectionContext) {
  return (
    a.base === b.base &&
    a.patch === b.patch &&
    a.page === b.page &&
    a.candidateIds === b.candidateIds &&
    a.filterKey === b.filterKey &&
    a.isFilterPending === b.isFilterPending
  );
}

/** Keep target selection separate from the eligible actions on each alternative. */
export function CandidateTargetChoices({
  candidates,
  onDecision,
  onLeaveUnmatched,
}: {
  candidates: OsmConflationCandidateView[];
  onDecision: ConflationReviewProps["onDecision"];
  onLeaveUnmatched: ConflationReviewProps["onLeaveUnmatched"];
}) {
  const { isPending, runAction } = useAction();
  const groupId = useId();
  const source = candidates[0];
  if (!source || candidates.length < 2) return null;
  const selected = candidates.filter((candidate) => {
    const actions = resolveConflationActions(candidate, candidate.decision);
    return actions.transferProperties || actions.attachNetwork || actions.removeWay;
  });
  const leftUnmatched = candidates.every((candidate) => effectiveStatus(candidate) === "rejected");
  const choiceDescription = `${groupId}-help${selected.length > 1 ? ` ${groupId}-conflict` : ""}`;
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-2 p-2 border-b"
      aria-busy={isPending}
      aria-disabled={isPending ? true : undefined}
      aria-describedby={choiceDescription}
      aria-invalid={selected.length > 1 ? true : undefined}
    >
      <legend className="px-2 font-bold">Choose one base target</legend>
      <p id={`${groupId}-help`}>
        These are alternative matches for the same imported feature. Choosing a target schedules its
        eligible copying and connection actions. Adjust them below; removing a way requires its own
        explicit choice.
      </p>
      {selected.length > 1 ? (
        <p id={`${groupId}-conflict`} role="alert">
          More than one target is selected. Choose one target or leave this feature unmatched.
        </p>
      ) : null}
      {selected.length === 0 && !leftUnmatched ? (
        <p>No target selected. Choose one or leave this feature unmatched.</p>
      ) : null}
      <label className="flex min-h-8 items-center gap-2">
        <input
          type="radio"
          className={REVIEW_FOCUS}
          name={groupId}
          aria-disabled={isPending ? true : undefined}
          aria-describedby={`${choiceDescription} ${groupId}-unmatched`}
          checked={selected.length === 0 && leftUnmatched}
          onChange={() => {
            if (!isPending) runAction(() => onLeaveUnmatched(source));
          }}
        />
        Leave unmatched
      </label>
      <p id={`${groupId}-unmatched`} className="text-muted-foreground">
        Leaving unmatched keeps ordinary imported additions.
      </p>
      {candidates.map((candidate) => {
        const actions = resolveConflationActions(candidate, {
          candidateId: candidate.id,
          action: "accept",
        });
        const eligible = actions.transferProperties || actions.attachNetwork;
        const reasonId = `${groupId}-${candidate.id}`;
        return (
          <div key={candidate.id} className="flex flex-col gap-1">
            <label className="flex min-h-8 items-center gap-2">
              <input
                type="radio"
                className={REVIEW_FOCUS}
                name={groupId}
                checked={selected.length === 1 && selected[0]?.id === candidate.id}
                disabled={!eligible}
                aria-disabled={eligible && isPending ? true : undefined}
                aria-describedby={`${choiceDescription}${!eligible ? ` ${reasonId}` : ""}`}
                onChange={() => {
                  // Keep native radio focus and arrow navigation through an async commit.
                  if (isPending) return;
                  runAction(() =>
                    onDecision({
                      candidateId: candidate.id,
                      action: "accept",
                      ...actions,
                    }),
                  );
                }}
              />
              Base {candidate.entityType} {candidate.targetId ?? "unavailable"}
              {candidate.matchesFilter === false ? " (outside current filters)" : ""}
            </label>
            {!eligible ? (
              <p id={reasonId} className="text-muted-foreground">
                Unavailable:{" "}
                {candidate.reasons.map(conflationReasonLabel).join(", ") ||
                  "No eligible matching action"}
                .
              </p>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}

export function ConflationReview({
  base,
  patch,
  summary,
  page,
  filter,
  isFilterPending,
  allowWayRemoval = false,
  onDecision,
  onResetDecision,
  onLeaveUnmatched,
  onBulkDecision,
  onFilterChange,
  onPageChange,
}: ConflationReviewProps) {
  const { isPending, runAction } = useAction();
  const isReviewPending = isFilterPending || isPending;
  const validationConflict = page.validationConflict;
  const candidatesBySource = Map.groupBy(
    page.candidates,
    (candidate) => `${candidate.entityType}:${candidate.sourceId}`,
  );

  const map = useMap();
  const [comparison, setComparison] = useAtom(conflationComparisonAtom);
  const candidateIds = page.candidates.map((candidate) => candidate.id).join("|");
  const filterKey = JSON.stringify([
    filter.entityType,
    filter.status,
    filter.reason,
    filter.sourceId,
    filter.targetId,
  ]);
  // A selection only stays valid for the review page it was made on.
  const selectionContext: SelectionContext = {
    base,
    patch,
    page: page.page,
    candidateIds,
    filterKey,
    isFilterPending,
  };
  const [storedSelection, setSelection] = useState<{
    context: SelectionContext;
    candidateId: string;
    geometry: GeoJSON.FeatureCollection;
  } | null>(null);
  const selection =
    storedSelection && sameSelectionContext(storedSelection.context, selectionContext)
      ? storedSelection
      : null;
  const reviewId = useId();
  const selectedCandidate =
    selection?.geometry === comparison
      ? page.candidates.find((candidate) => candidate.id === selection.candidateId)
      : undefined;
  useEffect(() => {
    setComparison({ type: "FeatureCollection", features: [] });
  }, [base, patch, page.page, candidateIds, filterKey, isFilterPending, setComparison]);
  useEffect(
    () => () => {
      setComparison({ type: "FeatureCollection", features: [] });
    },
    [setComparison],
  );

  const showCandidate = (candidate: OsmConflationCandidateView) => {
    if (selectedCandidate?.id === candidate.id) {
      setSelection(null);
      setComparison({ type: "FeatureCollection", features: [] });
      return;
    }
    const geometry = createConflationComparison(base, patch, candidate);
    setComparison(geometry);
    setSelection({ context: selectionContext, candidateId: candidate.id, geometry });
    const bounds = comparisonBounds(geometry);
    if (!map || !bounds) return;
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 80, maxDuration: 200, maxZoom: 19 },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <Card>
        <CardHeader>
          Match summary
          <CardAction>
            <ConflationStatusLegend />
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          <p className="p-2 border-b">
            A proposed match compares an imported feature with a base feature. OSM tags are feature
            attributes, such as a surface type. Nodes are points; ways are ordered point sequences
            forming lines or area boundaries. Choose actions independently; selections enter the
            next preview and update the dataset only when you apply it.
          </p>
          <SummaryTable summary={summary} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>Match filters</CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <p id={`${reviewId}-filters-help`} className="w-full text-muted-foreground">
            Filter proposed matches by their scheduled or unresolved status, feature type, or
            explanation. Alternatives outside these filters remain labeled context; bulk choices
            affect matching rows only.
          </p>
          {filter.sourceId !== undefined ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              <span>
                Showing imported {filter.entityType ?? "feature"} {filter.sourceId}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={isReviewPending}
                onClick={() =>
                  runAction(() =>
                    onFilterChange({ ...filter, entityType: undefined, sourceId: undefined }),
                  )
                }
              >
                Show all imported features
              </Button>
            </div>
          ) : null}
          <label
            className="flex w-full min-w-0 flex-col items-start gap-1"
            htmlFor="conflation-status-filter"
          >
            Match status
            <select
              id="conflation-status-filter"
              className={cn("h-8 w-full min-w-0 rounded border bg-background px-2", REVIEW_FOCUS)}
              aria-describedby={`${reviewId}-filters-help`}
              disabled={isReviewPending}
              value={filter.status ?? ""}
              onChange={(event) => {
                const status = event.target.value as OsmConflationEffectiveStatus | "";
                void onFilterChange({ ...filter, status: status || undefined });
              }}
            >
              <option value="">All statuses</option>
              {(
                ["accepted", "automatic", "review", "blocked", "unmatched", "rejected"] as const
              ).map((status) => (
                <option key={status} value={status}>
                  {conflationStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>

          <label
            className="flex w-full min-w-0 flex-col items-start gap-1"
            htmlFor="conflation-entity-filter"
          >
            Feature type
            <select
              id="conflation-entity-filter"
              className={cn("h-8 w-full min-w-0 rounded border bg-background px-2", REVIEW_FOCUS)}
              aria-describedby={`${reviewId}-filters-help`}
              disabled={isReviewPending}
              value={filter.entityType ?? ""}
              onChange={(event) => {
                const entityType = event.target.value as "node" | "way" | "";
                void onFilterChange({ ...filter, entityType: entityType || undefined });
              }}
            >
              <option value="">All feature types</option>
              <option value="node">Point (OSM node)</option>
              <option value="way">Line or area (OSM way)</option>
            </select>
          </label>

          <label
            className="flex w-full min-w-0 flex-col items-start gap-1"
            htmlFor="conflation-reason-filter"
          >
            <span className="shrink-0">Match reason</span>
            <select
              id="conflation-reason-filter"
              className={cn("h-8 w-full min-w-0 rounded border bg-background px-2", REVIEW_FOCUS)}
              aria-describedby={`${reviewId}-filters-help`}
              disabled={isReviewPending}
              value={filter.reason ?? ""}
              onChange={(event) => {
                const reason = event.target.value as OsmConflationReasonCode | "";
                void onFilterChange({ ...filter, reason: reason || undefined });
              }}
            >
              <option value="">All reasons</option>
              {REASON_CODES.map((reason) => (
                <option key={reason} value={reason}>
                  {conflationReasonLabel(reason)}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      <Card aria-busy={isReviewPending}>
        <ConflationResultsHeader
          isFilterPending={isFilterPending}
          totalCandidates={page.totalCandidates}
        />
        <CardContent className={cn("p-0", isFilterPending && "opacity-60")} inert={isFilterPending}>
          {validationConflict ? (
            <div className="flex flex-col gap-2 p-2 border-b" role="alert">
              <p>
                {validationConflict.message} Choose a single target before using bulk actions or
                generating a preview.
              </p>
              <Button
                variant="outline"
                disabled={isReviewPending}
                onClick={() =>
                  runAction(() =>
                    onFilterChange({
                      entityType: validationConflict.entityType,
                      sourceId: validationConflict.sourceId,
                    }),
                  )
                }
              >
                Review imported {validationConflict.entityType} {validationConflict.sourceId}
              </Button>
            </div>
          ) : null}
          <ConflationBulkActions
            bulkActions={page.bulkActions}
            disabled={isReviewPending}
            filter={filter}
            onBulkDecision={onBulkDecision}
          />
          {page.groups ? (
            <p className="p-2 border-b text-muted-foreground">
              Imported features matching these filters: {page.totalSources?.toLocaleString()}. All
              their alternatives are shown together. Bulk actions affect only matches inside the
              filters; ambiguous alternatives require an individual target choice.
            </p>
          ) : null}
          {page.candidates.length === 0 ? (
            <EmptyState>No candidates match these filters</EmptyState>
          ) : (
            <ItemGroup role="group" aria-label="Imported features">
              {[...candidatesBySource.entries()].map(([sourceKey, candidates]) => (
                <section
                  key={sourceKey}
                  aria-label={`Imported ${candidates[0]?.entityType} ${candidates[0]?.sourceId}`}
                >
                  <h3 className="p-2 font-bold border-b">
                    Imported {candidates[0]?.entityType} {candidates[0]?.sourceId}
                  </h3>
                  <CandidateTargetChoices
                    candidates={candidates}
                    onDecision={onDecision}
                    onLeaveUnmatched={onLeaveUnmatched}
                  />
                  {candidates.map((candidate) => {
                    const status = effectiveStatus(candidate);
                    return (
                      <Item key={candidate.id} className="p-0" variant="outline">
                        <ItemContent className="min-w-0 gap-0">
                          <div className="flex min-w-0 items-start gap-2 p-2">
                            <StatusDot className="mt-1" status={STATUS_DOT[status]} />
                            <div className="min-w-0 flex-1">
                              <ItemTitle>
                                Imported {featureLabel(candidate.entityType)} →{" "}
                                {candidate.targetId == null
                                  ? "No eligible base target"
                                  : `Base ${featureLabel(candidate.entityType)}`}
                              </ItemTitle>
                              <p className="select-all break-words text-muted-foreground">
                                {conflationCandidateTitle(candidate)}
                              </p>
                              <ItemDescription>
                                {conflationStatusLabel(status)};{" "}
                                {conflationDistanceLabel(candidate)}
                                {candidate.reasons.length > 0
                                  ? `; ${candidate.reasons.map(conflationReasonLabel).join(", ")}`
                                  : ""}
                              </ItemDescription>
                              {candidate.matchesFilter === false ? (
                                <p className="text-muted-foreground">
                                  Outside current filters · shown as an alternative
                                </p>
                              ) : null}
                              <CandidateActionStatuses candidate={candidate} />
                            </div>
                            <ItemActions>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Compare imported ${candidate.entityType} ${candidate.sourceId} with ${candidate.targetId == null ? "no base target" : `base ${candidate.entityType} ${candidate.targetId}`}`}
                                aria-pressed={selectedCandidate?.id === candidate.id}
                                aria-controls={`${reviewId}-comparison`}
                                className={cn(
                                  REVIEW_FOCUS,
                                  selectedCandidate?.id === candidate.id &&
                                    "bg-info/10 ring-1 ring-info",
                                )}
                                onClick={() => showCandidate(candidate)}
                              >
                                <LocateFixedIcon aria-hidden="true" />
                              </Button>
                            </ItemActions>
                          </div>
                          {selectedCandidate?.id === candidate.id ? (
                            <div id={`${reviewId}-comparison`}>
                              <ConflationComparisonEvidence
                                candidate={candidate}
                                comparison={comparison}
                              />
                            </div>
                          ) : null}
                          <CandidateEvidence candidate={candidate} />
                          <CandidateActions
                            candidate={candidate}
                            onDecision={onDecision}
                            onResetDecision={onResetDecision}
                            onReviewConnection={(sourceNodeId) =>
                              onFilterChange({ entityType: "node", sourceId: sourceNodeId })
                            }
                            showSkip={candidates.length === 1}
                            allowWayRemoval={allowWayRemoval}
                          />
                        </ItemContent>
                      </Item>
                    );
                  })}
                </section>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      <ButtonGroup className="w-full">
        <Button
          className="flex-1"
          disabled={isReviewPending || page.page <= 0}
          variant="outline"
          onClick={() => runAction(() => onPageChange(page.page - 1))}
        >
          Previous
        </Button>
        <ButtonGroupSeparator />
        <Button className="flex-1" disabled variant="outline">
          Page {page.totalPages === 0 ? 0 : page.page + 1} of {page.totalPages}
        </Button>
        <ButtonGroupSeparator />
        <Button
          className="flex-1"
          disabled={isReviewPending || page.page + 1 >= page.totalPages}
          variant="outline"
          onClick={() => runAction(() => onPageChange(page.page + 1))}
        >
          Next
        </Button>
      </ButtonGroup>

      <p role="status" aria-live="polite" className="sr-only">
        {selectedCandidate
          ? `Comparing ${conflationCandidateTitle(selectedCandidate)}. Coordinate evidence is shown with this match.`
          : ""}
      </p>
      {!selectedCandidate ? (
        <div id={`${reviewId}-comparison`}>
          <ConflationComparisonLegend />
        </div>
      ) : null}
      <p className="text-muted-foreground">
        Compare highlights geometry without scheduling an action. Skipping schedules no matching
        actions; ordinary imported additions remain in the merge.
      </p>
    </div>
  );
}
