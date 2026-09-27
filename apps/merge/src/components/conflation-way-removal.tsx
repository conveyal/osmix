import {
  ActionButton,
  Details,
  DetailsContent,
  DetailsSummary,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Pager,
} from "@osmix/ui";
import type { OsmConflationOutcomeReport, OsmConflationWayRemovalPreview } from "osmix";
import { useState } from "react";

function ids(values: number[]) {
  return values.length ? values.join(", ") : "none";
}

/** Concrete consequences shared by candidate review and the generated/applied report. */
export function WayRemovalDetails({
  preview,
  applied = false,
  onReviewConnection,
}: {
  preview: OsmConflationWayRemovalPreview;
  applied?: boolean;
  onReviewConnection?: (sourceNodeId: number) => Promise<void>;
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-2 wrap-break-word"
      aria-label={`Removal details for imported way ${preview.sourceWayId}`}
    >
      <p className="font-semibold">
        {applied ? "Removed" : "Remove"} imported way {preview.sourceWayId};{" "}
        {applied ? "retained" : "retain"} base way {preview.retainedWayId}.
      </p>
      <p>
        {applied ? "Removed newly orphaned points" : "Newly orphaned points to remove"}:{" "}
        {ids(preview.orphanNodeIds)}. Only untagged imported points with no remaining references are
        included.
      </p>
      <p>Tagged imported points retained: {ids(preview.retainedTaggedNodeIds)}.</p>
      {preview.connections.length ? (
        <ul className="flex flex-col gap-2" aria-label="Retained branch connections">
          {preview.connections.map((connection) => (
            <li key={connection.sourceNodeId} className="flex flex-col gap-1">
              <p>
                Imported point {connection.sourceNodeId}: retained ways{" "}
                {ids(connection.retainedWayIds)}
                {connection.targetNodeId === null
                  ? "; no equivalent base point."
                  : ` → base point ${connection.targetNodeId}.`}
              </p>
              <p className="text-muted-foreground">
                {connection.explicitlyAccepted
                  ? connection.attachmentCandidateId
                    ? applied
                      ? "Explicit network connection applied."
                      : "Explicit network connection selected."
                    : "Already connected to this base point."
                  : connection.attachmentCandidateId
                    ? "Select this network connection before removing the way."
                    : "No verified connection is available; keep the imported way."}
              </p>
              {!applied && onReviewConnection && connection.attachmentCandidateId ? (
                <ActionButton
                  variant="outline"
                  className="h-auto min-h-8 max-w-full text-left whitespace-normal"
                  onAction={() => onReviewConnection(connection.sourceNodeId)}
                >
                  Review connection at imported point {connection.sourceNodeId}
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState className="p-0">No retained imported branches depend on this way</EmptyState>
      )}
      {preview.blockedNodeIds.length ? (
        <p className="text-destructive">
          Removal checks not passed at imported points: {ids(preview.blockedNodeIds)}.
        </p>
      ) : null}
      {preview.blockingRelationIds.length ? (
        <p className="text-destructive">
          Related OSM relations prevent removal: {ids(preview.blockingRelationIds)}. Keep the
          imported way to preserve those memberships.
        </p>
      ) : null}
      <p className="text-muted-foreground">
        {applied
          ? "The imported way and its remaining attributes were removed. Copying selected tags was a separate action."
          : "Removing this way also removes its remaining attributes. Choose Copy tags separately for selected values that should remain on the base."}
      </p>
      <Details>
        <DetailsSummary>Original attributes on the imported way</DetailsSummary>
        <DetailsContent className="flex flex-col gap-2 p-inset">
          {Object.entries(preview.sourceTags).map(([key, value]) => (
            <div key={key} className="min-w-0 wrap-break-word">
              <span className="font-mono font-semibold">{key}</span>:{" "}
              <span className="select-all">{value}</span>
            </div>
          ))}
          {Object.keys(preview.sourceTags).length === 0 ? (
            <EmptyState className="p-0">No imported way attributes</EmptyState>
          ) : null}
        </DetailsContent>
      </Details>
    </section>
  );
}

/** Read the existing generated outcome; never create a second removal-preview state. */
export function ConflationWayRemovalPreview({
  outcome,
  applied = false,
}: {
  outcome: OsmConflationOutcomeReport;
  applied?: boolean;
}) {
  const [requestedPage, setPage] = useState(0);
  const removals = outcome.features.flatMap((feature) =>
    feature.wayRemoval ? [feature.wayRemoval] : [],
  );
  const pageSize = 10;
  const pages = Math.ceil(removals.length / pageSize);
  const page = Math.min(requestedPage, Math.max(0, pages - 1));
  return (
    <Card role="region" aria-label={applied ? "Applied way removals" : "Way removal preview"}>
      <CardHeader>{applied ? "Applied way removals" : "Way removal preview"}</CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2">
        <p>
          {applied ? "Removed imported ways" : "Imported ways to remove"}: {removals.length}.{" "}
          {applied ? "Removed orphan points" : "Orphan points to remove"}:{" "}
          {outcome.summary.removedOrphanNodes ?? 0}.
        </p>
        <p>
          {applied
            ? "These removals were accepted in the plan and applied with it."
            : "These removals are planned. The dataset changes only when you apply the plan."}
        </p>
        {removals.length ? (
          <ul className="flex min-w-0 flex-col divide-y" aria-label="Imported way removal plans">
            {removals.slice(page * pageSize, (page + 1) * pageSize).map((preview) => (
              <li key={preview.sourceWayId} className="min-w-0 py-2">
                <WayRemovalDetails preview={preview} applied={applied} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="p-0">
            No imported way was selected for this removal action
          </EmptyState>
        )}
        <Pager label="Way removal pages" page={page} pageCount={pages} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
}
