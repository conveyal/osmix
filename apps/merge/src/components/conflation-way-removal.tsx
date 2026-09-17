import {
  ActionButton,
  Details,
  DetailsContent,
  DetailsSummary,
  Button,
  Card,
  CardContent,
  CardHeader,
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
      className="flex min-w-0 flex-col gap-2 break-words"
      aria-label={`Removal details for imported way ${preview.sourceWayId}`}
    >
      <p className="font-bold">
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
                  size="sm"
                  variant="outline"
                  className="h-auto min-h-8 max-w-full whitespace-normal text-left"
                  onAction={() => onReviewConnection(connection.sourceNodeId)}
                >
                  Review connection at imported point {connection.sourceNodeId}
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>No retained imported branches depend on this way.</p>
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
        <DetailsContent className="flex flex-col gap-2 p-2">
          {Object.entries(preview.sourceTags).map(([key, value]) => (
            <div key={key} className="min-w-0 break-words">
              <span className="font-bold">{key}</span>: <span className="select-all">{value}</span>
            </div>
          ))}
          {Object.keys(preview.sourceTags).length === 0 ? <p>No imported way attributes.</p> : null}
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
            ? "These explicit removals were applied during matching, before later intersection work."
            : "This is the generated plan. The dataset changes only when you apply the cumulative merge. Changing a matching choice requires a new preview."}
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
          <p>No imported way was selected for this removal action.</p>
        )}
        {pages > 1 ? (
          <nav className="flex items-center justify-between gap-2" aria-label="Way removal pages">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span>
              Page {page + 1} of {pages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </nav>
        ) : null}
      </CardContent>
    </Card>
  );
}
