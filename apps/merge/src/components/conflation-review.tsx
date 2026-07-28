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
import { osmEntityToGeoJSONFeature } from "osmix";
import { useState } from "react";

import { useMap } from "../hooks/map";
import { conflationBulkActionCopy } from "../lib/conflation-workflow";
import { cn } from "../lib/utils";
import { conflationComparisonAtom } from "../state/conflation";
import ActionButton from "./action-button";
import { Details, DetailsContent, DetailsSummary } from "./details";
import { InfoTooltip } from "./info-tooltip";
import { EmptyState } from "./section";
import { StatusDot, type StatusDotStatus } from "./status-dot";
import { Button } from "./ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "./ui/button-group";
import { Card, CardAction, CardContent, CardHeader } from "./ui/card";
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
  automatic: "Automatic",
  blocked: "Blocked",
  rejected: "Rejected",
  review: "Needs review",
  unmatched: "Unmatched",
};

const STATUS_HELP: Record<OsmConflationEffectiveStatus, string> = {
  accepted: "an explicit decision will apply the selected fuzzy action",
  automatic: "at least one high-confidence action applies unless rejected",
  blocked: "at least one action is prevented by a structural safety rule",
  rejected: "fuzzy actions are disabled by an explicit decision",
  review: "at least one action needs a decision; another action may already be automatic",
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
  onBulkDecision: (request: OsmConflationBulkDecisionRequest) => Promise<void>;
  onFilterChange: (filter: OsmConflationCandidateFilter) => Promise<void>;
  onPageChange: (page: number) => Promise<void>;
}

function effectiveStatus(candidate: OsmConflationCandidateView) {
  if (candidate.decision?.action === "accept") return "accepted" as const;
  if (candidate.decision?.action === "reject") return "rejected" as const;
  return candidate.status;
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
          assessed independently.
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

export function CandidateActionStatuses({ candidate }: { candidate: OsmConflationCandidateView }) {
  return (
    <div className="flex flex-wrap gap-x-3 text-muted-foreground" aria-label="Action statuses">
      <span>
        Property transfer:{" "}
        <span className="font-bold text-foreground">
          {conflationStatusLabel(candidate.propertyTransfer.status)}
        </span>
      </span>
      {candidate.networkAttachment ? (
        <span>
          Network attachment:{" "}
          <span className="font-bold text-foreground">
            {conflationStatusLabel(candidate.networkAttachment.status)}
          </span>
        </span>
      ) : null}
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
            Bulk decisions apply to every match in the current filters across all pages. Automatic
            matches already apply unless rejected.
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
                {selectedCopy.description} This applies across every filtered page and replaces
                prior decisions shown below.
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
}: {
  candidate: OsmConflationCandidateView;
  onDecision: (decision: OsmConflationDecision) => Promise<void>;
}) {
  const canTransferProperties =
    candidate.propertyTransfer.status !== "blocked" &&
    candidate.propertyTransfer.status !== "unmatched" &&
    candidate.evidence.tagDiff.length > 0;
  const canAttachNetwork =
    candidate.networkAttachment !== null &&
    candidate.networkAttachment.status !== "blocked" &&
    candidate.networkAttachment.status !== "unmatched";

  return (
    <div className="flex flex-wrap gap-1 p-2 border-t">
      {canTransferProperties ? (
        <ActionButton
          size="sm"
          variant="outline"
          onAction={() =>
            onDecision({
              candidateId: candidate.id,
              action: "accept",
              transferProperties: true,
              attachNetwork: false,
            })
          }
        >
          Transfer properties
        </ActionButton>
      ) : null}
      {canAttachNetwork ? (
        <ActionButton
          size="sm"
          variant="outline"
          onAction={() =>
            onDecision({
              candidateId: candidate.id,
              action: "accept",
              transferProperties: false,
              attachNetwork: true,
            })
          }
        >
          Attach network
        </ActionButton>
      ) : null}
      {canTransferProperties && canAttachNetwork ? (
        <ActionButton
          size="sm"
          onAction={() =>
            onDecision({
              candidateId: candidate.id,
              action: "accept",
              transferProperties: true,
              attachNetwork: true,
            })
          }
        >
          Transfer + attach
        </ActionButton>
      ) : null}
      <ActionButton
        size="sm"
        variant="ghost"
        onAction={() => onDecision({ candidateId: candidate.id, action: "reject" })}
      >
        Reject
      </ActionButton>
    </div>
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
  onBulkDecision,
  onFilterChange,
  onPageChange,
}: ConflationReviewProps) {
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
              disabled={isFilterPending}
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
              disabled={isFilterPending}
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
              disabled={isFilterPending}
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

      <Card aria-busy={isFilterPending}>
        <ConflationResultsHeader
          isFilterPending={isFilterPending}
          totalCandidates={page.totalCandidates}
        />
        <CardContent className={cn("p-0", isFilterPending && "opacity-60")} inert={isFilterPending}>
          <ConflationBulkActions
            bulkActions={page.bulkActions}
            disabled={isFilterPending}
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
                      <CandidateActions candidate={candidate} onDecision={onDecision} />
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
          disabled={isFilterPending || page.page <= 0}
          variant="outline"
          onClick={() => void onPageChange(page.page - 1)}
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
          disabled={isFilterPending || page.page + 1 >= page.totalPages}
          variant="outline"
          onClick={() => void onPageChange(page.page + 1)}
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
          Reject behavior
          <InfoTooltip label="About rejecting a match" side="top" align="start">
            Rejecting disables fuzzy property transfer and network attachment. It does not remove
            the imported entity from the ordinary direct merge.
          </InfoTooltip>
        </span>
      </div>
    </div>
  );
}
