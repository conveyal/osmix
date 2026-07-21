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
import { EmptyState } from "./section";
import { StatusDot, type StatusDotStatus } from "./status-dot";
import { Button } from "./ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "./ui/button-group";
import { Card, CardContent, CardHeader } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "./ui/item";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";

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

export interface ConflationReviewProps {
  base: Osm;
  patch: Osm;
  summary: OsmConflationSummary;
  page: OsmConflationPage;
  filter: OsmConflationCandidateFilter;
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
            <TableCell>{key}</TableCell>
            <TableCell>{summary[key].toLocaleString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
  filter,
  onBulkDecision,
}: {
  bulkActions: OsmConflationPage["bulkActions"];
  filter: OsmConflationCandidateFilter;
  onBulkDecision: (request: OsmConflationBulkDecisionRequest) => Promise<void>;
}) {
  const [selectedAction, setSelectedAction] = useState<OsmConflationBulkAction | null>(null);
  const selectedPreview = selectedAction ? bulkActions[selectedAction] : null;
  const selectedCopy = selectedAction ? conflationBulkActionCopy(selectedAction) : null;

  return (
    <>
      <div className="flex flex-col gap-2 border-b bg-muted/50 p-2">
        <p className="text-muted-foreground">
          Bulk decisions apply to every match in the current filters across all pages. Automatic
          matches already apply unless rejected.
        </p>
        <div className="flex flex-wrap gap-1">
          {BULK_ACTIONS.map((action) => {
            const preview = bulkActions[action];
            const copy = conflationBulkActionCopy(action);
            return (
              <Button
                key={action}
                disabled={preview.changedCandidates === 0}
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

function CandidateEvidence({ candidate }: { candidate: OsmConflationCandidateView }) {
  const { evidence } = candidate;
  return (
    <Details>
      <DetailsSummary>Evidence and property diff</DetailsSummary>
      <DetailsContent>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>distance</TableCell>
              <TableCell>{evidence.distanceMeters.toFixed(3)} m</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>source routing</TableCell>
              <TableCell>{evidence.sourceRoutingFamilies.join(", ") || "none"}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>target routing</TableCell>
              <TableCell>{evidence.targetRoutingFamilies.join(", ") || "none"}</TableCell>
            </TableRow>
            {evidence.bearingDifferenceDegrees !== undefined ? (
              <TableRow>
                <TableCell>bearing difference</TableCell>
                <TableCell>{evidence.bearingDifferenceDegrees.toFixed(1)}°</TableCell>
              </TableRow>
            ) : null}
            {evidence.lengthDifferenceRatio !== undefined ? (
              <TableRow>
                <TableCell>length difference</TableCell>
                <TableCell>{(evidence.lengthDifferenceRatio * 100).toFixed(1)}%</TableCell>
              </TableRow>
            ) : null}
            {evidence.maxGeometryDistanceMeters !== undefined ? (
              <TableRow>
                <TableCell>maximum geometry distance</TableCell>
                <TableCell>{evidence.maxGeometryDistanceMeters.toFixed(3)} m</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {evidence.tagDiff.length > 0 ? (
          <Table>
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
                  <TableCell>→ {String(diff.patchValue)}</TableCell>
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

function CandidateActions({
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
          Use both
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

export function ConflationReview({
  base,
  patch,
  summary,
  page,
  filter,
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
        <CardHeader>Candidate summary</CardHeader>
        <CardContent className="p-0">
          <SummaryTable summary={summary} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>Candidate filters</CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <label className="flex items-center gap-1" htmlFor="conflation-status-filter">
            Status
            <select
              id="conflation-status-filter"
              className="h-7 rounded border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              value={filter.status ?? ""}
              onChange={(event) => {
                const status = event.target.value as OsmConflationEffectiveStatus | "";
                void onFilterChange({ ...filter, status: status || undefined });
              }}
            >
              <option value="">all</option>
              {(
                ["accepted", "automatic", "review", "blocked", "unmatched", "rejected"] as const
              ).map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1" htmlFor="conflation-entity-filter">
            Entity
            <select
              id="conflation-entity-filter"
              className="h-7 rounded border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              value={filter.entityType ?? ""}
              onChange={(event) => {
                const entityType = event.target.value as "node" | "way" | "";
                void onFilterChange({ ...filter, entityType: entityType || undefined });
              }}
            >
              <option value="">all</option>
              <option value="node">node</option>
              <option value="way">way</option>
            </select>
          </label>

          <label className="flex items-center gap-1" htmlFor="conflation-reason-filter">
            Reason
            <select
              id="conflation-reason-filter"
              className="h-7 rounded border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              value={filter.reason ?? ""}
              onChange={(event) => {
                const reason = event.target.value as OsmConflationReasonCode | "";
                void onFilterChange({ ...filter, reason: reason || undefined });
              }}
            >
              <option value="">all</option>
              {REASON_CODES.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>Filtered matches ({page.totalCandidates.toLocaleString()})</CardHeader>
        <CardContent className="p-0">
          <ConflationBulkActions
            bulkActions={page.bulkActions}
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
                          <ItemTitle>
                            {candidate.entityType} {candidate.sourceId} →{" "}
                            {candidate.targetId ?? "no target"}
                          </ItemTitle>
                          <ItemDescription>
                            {status}; {candidate.evidence.distanceMeters.toFixed(3)} m
                            {candidate.reasons.length > 0
                              ? `; ${candidate.reasons.join(", ")}`
                              : ""}
                          </ItemDescription>
                        </div>
                        <ItemActions>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            title="Compare source and target on map"
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
          disabled={page.page <= 0}
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
          disabled={page.page + 1 >= page.totalPages}
          variant="outline"
          onClick={() => void onPageChange(page.page + 1)}
        >
          Next
        </Button>
      </ButtonGroup>

      <p className="text-muted-foreground">
        Map comparison: <span className="text-destructive">imported source</span> and{" "}
        <span className="text-info">base target</span>.
      </p>
    </div>
  );
}
