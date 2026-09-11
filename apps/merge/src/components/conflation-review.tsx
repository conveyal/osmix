import { useSetAtom } from "jotai";
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
  osmEntityToGeoJSONFeature,
  resolveConflationActions,
} from "osmix";
import { useId, useState } from "react";

import { useMap } from "../hooks/map";
import { conflationBulkActionCopy } from "../lib/conflation-workflow";
import { cn } from "../lib/utils";
import { conflationComparisonAtom } from "../state/conflation";
import ActionButton, { useAction } from "./action-button";
import { Details, DetailsContent, DetailsSummary } from "./details";
import { InfoTooltip } from "./info-tooltip";
import { EmptyState } from "./section";
import { StatusDot, type StatusDotStatus } from "./status-dot";
import { Button } from "./ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "./ui/button-group";
import { Card, CardAction, CardContent, CardHeader } from "./ui/card";
import { Checkbox, CheckboxLabel } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "./ui/item";
import { Spinner } from "./ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const REASON_CODES = [
  "bearing-mismatch",
  "drivable-network",
  "exact-match",
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
  accepted: "Accepted",
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
  "geometry-mismatch": "Geometry differs",
  "grade-conflict": "Grade separation conflicts",
  "length-mismatch": "Lengths differ",
  "many-to-one": "Multiple imported entities share one base target",
  "multiple-targets": "Multiple possible base targets",
  "no-transferable-properties": "No selected properties differ",
  "node-context-conflict": "Connected-way context conflicts",
  "non-routing-target": "Base target is not routable",
  "protected-tag": "Protected structural property differs",
  "relation-member": "Entity participates in a relation",
  "routing-family-conflict": "Routing uses are incompatible",
  "routing-property": "Routing property requires review",
  "same-id": "Handled as a same-ID update",
  "unsupported-way-chain": "One-to-many way matching is unsupported",
  "would-collapse-way": "Attachment would collapse a way",
};

const ROUTING_FAMILY_LABEL = {
  "bicycle-shared": "Bicycle or shared-use",
  "motor-road": "Motor road",
  "non-routable": "Non-routable",
  pedestrian: "Pedestrian",
} as const;

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
  onDecision: (decision: OsmConflationDecision) => Promise<void>;
  onResetDecision: (candidateId: string) => Promise<void>;
  onBulkDecision: (request: OsmConflationBulkDecisionRequest) => Promise<void>;
  onFilterChange: (filter: OsmConflationCandidateFilter) => Promise<void>;
  onPageChange: (page: number) => Promise<void>;
}

function effectiveStatus(candidate: OsmConflationCandidateView) {
  return conflationEffectiveStatus(candidate, candidate.decision ? [candidate.decision] : []);
}

function entityFeature(
  osm: Osm,
  candidate: OsmConflationCandidateView,
  role: "source" | "target",
): GeoJSON.Feature | null {
  const id = role === "source" ? candidate.sourceId : candidate.targetId;
  if (id == null) return null;
  const entity = candidate.entityType === "node" ? osm.nodes.getById(id) : osm.ways.getById(id);
  if (!entity) return null;
  const feature = osmEntityToGeoJSONFeature(osm, entity);
  if (feature.type !== "Feature") return null;
  return {
    ...feature,
    properties: { ...feature.properties, role },
  };
}

function entityBbox(osm: Osm, candidate: OsmConflationCandidateView, role: "source" | "target") {
  const id = role === "source" ? candidate.sourceId : candidate.targetId;
  if (id == null) return null;
  if (candidate.entityType === "node") {
    const node = osm.nodes.getById(id);
    return node ? ([node.lon, node.lat, node.lon, node.lat] as const) : null;
  }
  return osm.ways.getEntityBbox({ id });
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
          Overall status summarizes the candidate. Property transfer and network attachment are
          assessed independently. Review reasons never lift a safety block. An eligible action can
          still run while the other action remains blocked.
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
] as const;

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
            <TableCell>{label}</TableCell>
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
        <div className="flex items-center gap-1 font-bold uppercase tracking-wide">
          Bulk decisions
          <InfoTooltip label="About bulk decisions" side="right" align="start">
            Bulk choices affect every match in the current filters across all pages. Automatic
            actions are already scheduled; preview changes before applying them.
          </InfoTooltip>
        </div>
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

export function CandidateEvidence({ candidate }: { candidate: OsmConflationCandidateView }) {
  const { evidence } = candidate;
  return (
    <Details>
      <DetailsSummary>Evidence and property diff</DetailsSummary>
      <DetailsContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <span className="flex items-center gap-1">
                  Evidence
                  <InfoTooltip label="About candidate evidence metrics" side="right" align="start">
                    Distance finds nearby candidates. Routing families describe allowed network use;
                    bearing compares direction, length difference compares total geometry length,
                    and maximum geometry distance measures the worst sampled separation.
                  </InfoTooltip>
                </span>
              </TableHead>
              <TableHead>Measured value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Candidate distance</TableCell>
              <TableCell>{evidence.distanceMeters.toFixed(3)} m</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Imported routing family</TableCell>
              <TableCell>
                {evidence.sourceRoutingFamilies
                  .map((family) => ROUTING_FAMILY_LABEL[family])
                  .join(", ") || "None"}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Base routing family</TableCell>
              <TableCell>
                {evidence.targetRoutingFamilies
                  .map((family) => ROUTING_FAMILY_LABEL[family])
                  .join(", ") || "None"}
              </TableCell>
            </TableRow>
            {evidence.bearingDifferenceDegrees !== undefined ? (
              <TableRow>
                <TableCell>Bearing difference</TableCell>
                <TableCell>{evidence.bearingDifferenceDegrees.toFixed(1)}°</TableCell>
              </TableRow>
            ) : null}
            {evidence.lengthDifferenceRatio !== undefined ? (
              <TableRow>
                <TableCell>Length difference</TableCell>
                <TableCell>{(evidence.lengthDifferenceRatio * 100).toFixed(1)}%</TableCell>
              </TableRow>
            ) : null}
            {evidence.maxGeometryDistanceMeters !== undefined ? (
              <TableRow>
                <TableCell>Maximum geometry distance</TableCell>
                <TableCell>{evidence.maxGeometryDistanceMeters.toFixed(3)} m</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {evidence.tagDiff.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Base value</TableHead>
                <TableHead>Imported value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evidence.tagDiff.map((diff) => (
                <TableRow
                  key={diff.key}
                  className={cn(
                    diff.protected && "bg-destructive/10",
                    !diff.protected && diff.routing && "bg-warning/10",
                  )}
                >
                  <TableCell>{diff.key}</TableCell>
                  <TableCell>{String(diff.baseValue ?? "not set")}</TableCell>
                  <TableCell>{String(diff.patchValue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState>No selected property differences</EmptyState>
        )}
      </DetailsContent>
    </Details>
  );
}

export function CandidateActions({
  candidate,
  onDecision,
  onResetDecision,
}: {
  candidate: OsmConflationCandidateView;
  onDecision: (decision: OsmConflationDecision) => Promise<void>;
  onResetDecision?: (candidateId: string) => Promise<void>;
}) {
  const { isPending, runAction } = useAction();
  const descriptionId = useId();
  const scheduled = resolveConflationActions(candidate, candidate.decision);
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-2 border-t p-2"
      disabled={isPending}
      aria-label={`Matching actions for imported ${candidate.entityType} ${candidate.sourceId}`}
    >
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
            <CheckboxLabel>
              <Checkbox
                checked={scheduled[action.selected]}
                disabled={isPending || !eligible}
                aria-describedby={!eligible ? helpId : undefined}
                onCheckedChange={(checked) =>
                  runAction(() =>
                    onDecision(
                      buildConflationActionDecision(
                        candidate,
                        candidate.decision,
                        action.action,
                        checked,
                      ),
                    ),
                  )
                }
              />
              {action.label}
            </CheckboxLabel>
            {!eligible ? (
              <p id={helpId} className="text-muted-foreground">
                {actionStatus(candidate, action)}: {reasons || "No eligible matching action"}.
              </p>
            ) : null}
          </div>
        );
      })}
      {!scheduled.transferProperties && !scheduled.attachNetwork ? (
        <p className="text-muted-foreground">
          No matching actions scheduled. Ordinary imported additions are kept.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        <ActionButton
          size="sm"
          variant="ghost"
          disabled={effectiveStatus(candidate) === "rejected"}
          onAction={() => onDecision({ candidateId: candidate.id, action: "reject" })}
        >
          Skip match
        </ActionButton>
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

export function ConflationReview({
  base,
  patch,
  summary,
  page,
  filter,
  isFilterPending,
  onDecision,
  onResetDecision,
  onBulkDecision,
  onFilterChange,
  onPageChange,
}: ConflationReviewProps) {
  const { isPending, runAction } = useAction();
  const isReviewPending = isFilterPending || isPending;
  const map = useMap();
  const setComparison = useSetAtom(conflationComparisonAtom);
  const showCandidate = (candidate: OsmConflationCandidateView) => {
    const sourceFeature = entityFeature(patch, candidate, "source");
    const targetFeature = entityFeature(base, candidate, "target");
    const features: GeoJSON.Feature[] = [];
    if (sourceFeature) features.push(sourceFeature);
    if (targetFeature) features.push(targetFeature);
    setComparison({
      type: "FeatureCollection",
      features,
    });

    const boxes = [
      entityBbox(patch, candidate, "source"),
      entityBbox(base, candidate, "target"),
    ].filter((bbox): bbox is readonly [number, number, number, number] => bbox !== null);
    if (!map || boxes.length === 0) return;
    const bounds = boxes.reduce(
      (result, bbox) => [
        Math.min(result[0], bbox[0]),
        Math.min(result[1], bbox[1]),
        Math.max(result[2], bbox[2]),
        Math.max(result[3], bbox[3]),
      ],
      [...boxes[0]],
    );
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 120, maxDuration: 200, maxZoom: 19 },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <Card>
        <CardHeader>
          Candidate summary
          <CardAction>
            <ConflationStatusLegend />
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          <p className="p-2 border-b">
            A match proposes how imported data corresponds to a base feature. OSM tags are feature
            attributes, such as a surface type. Choose actions independently; selections enter the
            next preview and update the dataset only when you apply it.
          </p>
          <SummaryTable summary={summary} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>Candidate filters</CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <label className="flex items-center gap-1" htmlFor="conflation-status-filter">
            Match status
            <select
              id="conflation-status-filter"
              className="h-7 rounded border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
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

          <label className="flex items-center gap-1" htmlFor="conflation-entity-filter">
            Entity type
            <select
              id="conflation-entity-filter"
              className="h-7 rounded border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              disabled={isReviewPending}
              value={filter.entityType ?? ""}
              onChange={(event) => {
                const entityType = event.target.value as "node" | "way" | "";
                void onFilterChange({ ...filter, entityType: entityType || undefined });
              }}
            >
              <option value="">All entity types</option>
              <option value="node">Node</option>
              <option value="way">Way</option>
            </select>
          </label>

          <label
            className="flex w-full min-w-0 items-center gap-1"
            htmlFor="conflation-reason-filter"
          >
            <span className="shrink-0">Match reason</span>
            <select
              id="conflation-reason-filter"
              className="h-7 min-w-0 max-w-full flex-1 rounded border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
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
          <ConflationBulkActions
            bulkActions={page.bulkActions}
            disabled={isReviewPending}
            filter={filter}
            onBulkDecision={onBulkDecision}
          />
          {page.candidates.length === 0 ? (
            <EmptyState>No candidates match these filters</EmptyState>
          ) : (
            <ItemGroup>
              {page.candidates.map((candidate) => {
                const status = effectiveStatus(candidate);
                return (
                  <Item key={candidate.id} className="p-0" variant="outline">
                    <ItemContent className="min-w-0 gap-0">
                      <div className="flex items-start gap-2 p-2">
                        <StatusDot className="mt-1" status={STATUS_DOT[status]} />
                        <div className="min-w-0 flex-1">
                          <ItemTitle>{conflationCandidateTitle(candidate)}</ItemTitle>
                          <ItemDescription>
                            {conflationStatusLabel(status)};{" "}
                            {candidate.evidence.distanceMeters.toFixed(3)} m
                            {candidate.reasons.length > 0
                              ? `; ${candidate.reasons.map(conflationReasonLabel).join(", ")}`
                              : ""}
                          </ItemDescription>
                          <CandidateActionStatuses candidate={candidate} />
                        </div>
                        <ItemActions>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title="Compare imported entity and base target on map"
                            onClick={() => showCandidate(candidate)}
                          >
                            <LocateFixedIcon />
                          </Button>
                        </ItemActions>
                      </div>
                      <CandidateEvidence candidate={candidate} />
                      <CandidateActions
                        candidate={candidate}
                        onDecision={onDecision}
                        onResetDecision={onResetDecision}
                      />
                    </ItemContent>
                  </Item>
                );
              })}
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

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span className="flex items-center gap-1">
          Map comparison
          <InfoTooltip label="About map comparison colors" side="top" align="start">
            The imported source is shown in destructive red and the proposed base target in
            informational blue.
          </InfoTooltip>
        </span>
        <span className="flex items-center gap-1">
          Skipping a match
          <InfoTooltip label="About skipping a match" side="top" align="start">
            Skipping schedules neither copying tags nor connecting networks. Ordinary imported
            additions remain in the merge.
          </InfoTooltip>
        </span>
      </div>
    </div>
  );
}
