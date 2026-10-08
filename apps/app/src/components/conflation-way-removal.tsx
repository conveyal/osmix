import { useOsmixRemote } from "@osmix/app-core";
import {
  Details,
  DetailsContent,
  DetailsSummary,
  Alert,
  EmptyState,
  LoadingState,
  Pager,
} from "@osmix/ui";
import type {
  MergeMatchingPage,
  MergePlanMatchingOutcome,
  OsmConflationWayRemovalPreview,
} from "osmix";
import { useState } from "react";

import { useWorkerPage, type WorkerPageState } from "../lib/use-worker-page";

function ids(values: number[]) {
  return values.length ? values.join(", ") : "none";
}

/** What one applied removal did: its counterpart, the points it cleaned up and its connections. */
function WayRemovalDetails({ preview }: { preview: OsmConflationWayRemovalPreview }) {
  return (
    <section
      className="flex min-w-0 flex-col gap-2 wrap-break-word"
      aria-label={`Removal details for imported way ${preview.sourceWayId}`}
    >
      <p className="font-semibold">
        Removed imported way {preview.sourceWayId}; retained base way {preview.retainedWayId}.
      </p>
      <p>
        Removed newly orphaned points: {ids(preview.orphanNodeIds)}. Only untagged imported points
        with no remaining references are included.
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
                    ? "Explicit network connection applied."
                    : "Already connected to this base point."
                  : "No network connection was applied here."}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState className="p-0">No retained imported branches depended on this way</EmptyState>
      )}
      <p className="text-muted-foreground">
        The imported way and its remaining attributes were removed. Copying selected tags was a
        separate action.
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

/**
 * The applied way removals of a completed merge, read from its matching outcome. A `Details`
 * that reaches the edges of the flush section it sits in (the merge completion summary).
 */
export function AppliedWayRemovals({
  baseOsmId,
  outcome,
}: {
  baseOsmId: string;
  outcome: MergePlanMatchingOutcome;
}) {
  const remote = useOsmixRemote();
  const [page, setPage] = useState(0);
  const loaded = useWorkerPage(String(page), () =>
    remote.getMergeMatchingPage(baseOsmId, "way-removal", page, WAY_REMOVAL_PAGE_SIZE),
  );
  return <WayRemovalSection outcome={outcome} loaded={loaded} page={page} onPageChange={setPage} />;
}

export const WAY_REMOVAL_PAGE_SIZE = 10;

/** The applied way removals for one loaded page (or its loading or failed state). */
export function WayRemovalSection({
  outcome,
  loaded,
  page,
  onPageChange,
}: {
  outcome: MergePlanMatchingOutcome;
  loaded: WorkerPageState<MergeMatchingPage> | null;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const removals = (loaded?.page?.features ?? []).flatMap((feature) =>
    feature.wayRemoval ? [feature.wayRemoval] : [],
  );
  return (
    <section aria-label="Applied way removals">
      <Details>
        <DetailsSummary>Applied way removals</DetailsSummary>
        <DetailsContent className="flex min-w-0 flex-col gap-2 p-inset">
          <p>
            Removed imported ways: {outcome.wayRemovalFeatures.toLocaleString()}. Removed orphan
            points: {outcome.summary.removedOrphanNodes ?? 0}.
          </p>
          <p>These removals were included in the plan and applied with it.</p>
          {loaded === null ? <LoadingState /> : null}
          {loaded?.error !== undefined ? (
            <Alert variant="destructive">These details could not be loaded. {loaded.error}</Alert>
          ) : null}
          {removals.length ? (
            <ul className="flex min-w-0 flex-col divide-y" aria-label="Imported way removals">
              {removals.map((preview) => (
                <li key={preview.sourceWayId} className="min-w-0 py-2">
                  <WayRemovalDetails preview={preview} />
                </li>
              ))}
            </ul>
          ) : null}
          <Pager
            label="Way removal pages"
            page={page}
            pageCount={loaded?.page?.totalPages ?? 0}
            onPageChange={onPageChange}
          />
        </DetailsContent>
      </Details>
    </section>
  );
}
