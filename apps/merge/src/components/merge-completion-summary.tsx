import { DownloadIcon } from "lucide-react";
import type { OsmConflationOutcomeReport } from "osmix";
import { useState } from "react";

import type { MergeCompletion } from "../state/merge-outcome";
import ActionButton from "./action-button";
import { conflationReasonLabel } from "./conflation-review";
import { ConflationWayRemovalPreview } from "./conflation-way-removal";
import { Details, DetailsContent, DetailsSummary } from "./details";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";

const PAGE_SIZE = 10;
const UNRESOLVED_LABELS = {
  ambiguous: "Multiple possible targets",
  blocked: "Matching action blocked",
  unmatched: "No matching target",
  review: "Choice still needed",
} as const;
const TAG_REASON_LABELS = {
  "no-accepted-target": "No target selected for copying",
  blocked: "Copying was blocked",
  "not-selected": "Copy tags was not selected",
  "protected-tag": "This structural tag is protected",
  superseded: "A later copy replaced this value",
} as const;

function OutcomePagination({
  page,
  pages,
  onPage,
  label,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-2 p-2 border-t">
      <Button size="sm" variant="outline" disabled={page <= 0} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span>
        Page {pages === 0 ? 0 : page + 1} of {pages}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page + 1 >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

function FeatureOutcomes({ outcome }: { outcome: OsmConflationOutcomeReport }) {
  const [filter, setFilter] = useState(
    outcome.summary.unresolvedFeatures > 0 ? "unresolved" : "all",
  );
  const [requestedPage, setPage] = useState(0);
  const features = outcome.features.filter(
    (feature) =>
      filter === "all" || (filter === "unresolved" ? feature.unresolved !== null : feature.skipped),
  );
  const pages = Math.ceil(features.length / PAGE_SIZE);
  const page = Math.min(requestedPage, Math.max(0, pages - 1));
  return (
    <Details defaultOpen={false}>
      <DetailsSummary>Imported feature outcomes</DetailsSummary>
      <DetailsContent>
        <label className="flex flex-wrap items-center gap-2 p-2 border-t">
          Show features
          <select
            className="min-w-0 border bg-background px-2 h-8"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(0);
            }}
          >
            <option value="unresolved">
              Unresolved ({outcome.summary.unresolvedFeatures.toLocaleString()})
            </option>
            <option value="skipped">
              Intentionally skipped ({outcome.summary.skippedFeatures.toLocaleString()})
            </option>
            <option value="all">
              All considered ({outcome.summary.features.toLocaleString()})
            </option>
          </select>
        </label>
        {features.length === 0 ? (
          <p className="p-2">No imported features in this category.</p>
        ) : (
          <ul className="divide-y border-t" aria-label="Imported feature outcome details">
            {features.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((feature) => (
              <li
                key={`${feature.entityType}:${feature.sourceId}`}
                className="flex flex-col gap-1 p-2 break-words"
              >
                <p className="font-bold">
                  Imported {feature.entityType} {feature.sourceId}
                  {feature.targetId === null
                    ? " · no single base target"
                    : ` · Base target considered during matching: ${feature.targetId}`}
                </p>
                <p>
                  {feature.skipped
                    ? "Intentionally skipped"
                    : feature.unresolved
                      ? UNRESOLVED_LABELS[feature.unresolved]
                      : "No unresolved matching work"}
                </p>
                <p>
                  Copied tags: {feature.copiedKeys.length ? feature.copiedKeys.join(", ") : "none"}.
                  Connected imported ways:{" "}
                  {feature.connectedWayIds.length ? feature.connectedWayIds.join(", ") : "none"}.
                </p>
                {feature.reasons.length > 0 ? (
                  <p className="text-muted-foreground">
                    {feature.reasons.map(conflationReasonLabel).join("; ")}
                  </p>
                ) : null}
                <p className="text-muted-foreground">
                  {feature.wayRemoval
                    ? `Explicitly removed in favor of base way ${feature.wayRemoval.retainedWayId}.`
                    : feature.retained
                      ? feature.ordinaryAddition
                        ? "Included as an ordinary imported addition."
                        : "The original imported ID remains after matching."
                      : "The original imported ID is not present after matching. Exact reconciliation may represent it with a base ID."}
                </p>
              </li>
            ))}
          </ul>
        )}
        <OutcomePagination
          page={page}
          pages={pages}
          onPage={setPage}
          label="Imported feature outcome pages"
        />
      </DetailsContent>
    </Details>
  );
}

function UncopiedTags({ outcome }: { outcome: OsmConflationOutcomeReport }) {
  const [key, setKey] = useState(
    outcome.tags.find((tag) => tag.uncopied.length > 0)?.key ?? outcome.tags[0]?.key ?? "",
  );
  const [requestedPage, setPage] = useState(0);
  const tag = outcome.tags.find((tag) => tag.key === key);
  const pages = Math.ceil((tag?.uncopied.length ?? 0) / PAGE_SIZE);
  const page = Math.min(requestedPage, Math.max(0, pages - 1));
  if (outcome.tags.length === 0) return null;
  return (
    <Details defaultOpen={false}>
      <DetailsSummary>Selected tag outcomes</DetailsSummary>
      <DetailsContent>
        <p className="p-2">
          Counts include imported features with a value for the selected tag. Values not copied to a
          base target can still be present on ordinary imported additions.
        </p>
        <label className="flex flex-wrap items-center gap-2 p-2 border-t">
          Selected tag
          <select
            className="min-w-0 max-w-full border bg-background px-2 h-8"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setPage(0);
            }}
          >
            {outcome.tags.map((tag) => (
              <option key={tag.key} value={tag.key}>
                {tag.key}
              </option>
            ))}
          </select>
        </label>
        {tag ? (
          <>
            <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 p-2 border-t">
              <dt>Imported features with this tag</dt>
              <dd>{tag.presentFeatures.toLocaleString()}</dd>
              <dt>Copied to a base target</dt>
              <dd>{tag.copiedFeatures.toLocaleString()}</dd>
              <dt>Already equal when considered</dt>
              <dd>{tag.alreadyEqualFeatures.toLocaleString()}</dd>
              <dt>Satisfied by another copy</dt>
              <dd>{tag.satisfiedByOtherCopyFeatures.toLocaleString()}</dd>
              <dt>Not copied</dt>
              <dd>{tag.uncopied.length.toLocaleString()}</dd>
            </dl>
            <ul className="divide-y border-t" aria-label="Selected tag not copied details">
              {tag.uncopied.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((feature) => (
                <li
                  key={`${feature.entityType}:${feature.sourceId}`}
                  className="flex flex-col gap-1 p-2 break-words"
                >
                  <p className="font-bold">
                    Imported {feature.entityType} {feature.sourceId}
                  </p>
                  <p>{TAG_REASON_LABELS[feature.reason]}</p>
                  {feature.reasons.length ? (
                    <p className="text-muted-foreground">
                      {feature.reasons.map(conflationReasonLabel).join("; ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {tag.uncopied.length === 0 ? (
              <p className="p-2">Every present value is satisfied in the result.</p>
            ) : null}
            <OutcomePagination
              page={page}
              pages={pages}
              onPage={setPage}
              label="Selected tag detail pages"
            />
          </>
        ) : null}
      </DetailsContent>
    </Details>
  );
}

/** Read-only evidence retained after a successfully applied merge, independent of live review. */
export function MergeCompletionSummary({
  completion,
  onDownloadReport,
}: {
  completion: MergeCompletion;
  onDownloadReport: () => Promise<unknown>;
}) {
  const { outcome } = completion;
  const summary = outcome?.summary;
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadReport = async () => {
    setDownloadError(null);
    try {
      await onDownloadReport();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setDownloadError(
        `The report could not be saved. ${error instanceof Error ? error.message : "Try downloading it again."}`,
      );
    }
  };

  return (
    <Card role="region" aria-label="Merge completion summary">
      <CardHeader>
        Merge complete
        {summary && summary.unresolvedFeatures > 0 ? " · unresolved matches remain" : ""}
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex flex-col gap-2 p-2">
          <p>You can download the merged dataset. This report describes the completed run.</p>
          {summary ? (
            <>
              <dl
                className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1"
                aria-label="Applied matching actions"
              >
                <dt>Tag-copy actions</dt>
                <dd>{summary.tagCopyActions.toLocaleString()}</dd>
                <dt>Attribute values updated</dt>
                <dd>{summary.copiedTagValues.toLocaleString()}</dd>
                <dt>Network connections</dt>
                <dd>{summary.networkAttachmentActions.toLocaleString()}</dd>
                {summary.wayRemovalActions !== undefined ? (
                  <>
                    <dt>Imported ways removed</dt>
                    <dd>{summary.wayRemovalActions.toLocaleString()}</dd>
                    <dt>Orphan points removed</dt>
                    <dd>{(summary.removedOrphanNodes ?? 0).toLocaleString()}</dd>
                  </>
                ) : null}
                <dt className="font-bold">Imported features unresolved</dt>
                <dd className="font-bold">{summary.unresolvedFeatures.toLocaleString()}</dd>
              </dl>
              <p>
                Imported features considered for matching: {summary.features.toLocaleString()}.{" "}
                Intentionally skipped: {summary.skippedFeatures.toLocaleString()}. Resolved without
                additional matching actions: {summary.unchangedFeatures.toLocaleString()}.
              </p>
              <p>
                Actions count actual changes from matching, after the ordinary merge. One feature
                can have several actions, or an applied action and another unresolved action.
              </p>
              <p>
                These details record the matching stage. The later intersection step can make more
                connections or change the junction IDs used by a way. Unresolved matching work
                remains listed here so you can review the original choices.
              </p>
              {summary.features === 0 ? (
                <p>
                  No imported features were considered for matching with these options. Ordinary
                  merge rules still applied.
                </p>
              ) : null}
              {summary.unresolvedFeatures > 0 ? (
                <dl
                  className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 border-t pt-2"
                  aria-label="Unresolved imported features"
                >
                  <dt>Multiple possible targets</dt>
                  <dd>{summary.ambiguousFeatures.toLocaleString()}</dd>
                  <dt>Blocked</dt>
                  <dd>{summary.blockedFeatures.toLocaleString()}</dd>
                  <dt>No matching target</dt>
                  <dd>{summary.unmatchedFeatures.toLocaleString()}</dd>
                  <dt>Choice still needed</dt>
                  <dd>{summary.reviewFeatures.toLocaleString()}</dd>
                </dl>
              ) : null}
            </>
          ) : (
            <p>Imported-data matching was not enabled. The ordinary merge has completed.</p>
          )}
          <p>
            Skipping or leaving a match unresolved does not itself discard the import. Explicit way
            removals are listed separately. Other additions remain under ordinary merge rules; exact
            reconciliation can represent an imported feature with a base ID.
          </p>
        </div>
        {outcome ? (
          <>
            <FeatureOutcomes outcome={outcome} />
            <UncopiedTags outcome={outcome} />
            {outcome.features.some((feature) => feature.wayRemoval) ? (
              <ConflationWayRemovalPreview outcome={outcome} applied />
            ) : null}
          </>
        ) : null}
        <div className="flex flex-col gap-2 p-2 border-t">
          <ActionButton icon={<DownloadIcon />} variant="outline" onAction={downloadReport}>
            Download merge report
          </ActionButton>
          {downloadError ? <p role="alert">{downloadError}</p> : null}
          <p className="text-muted-foreground break-words">
            Inputs: {completion.inputs.baseName} + {completion.inputs.patchName}.
          </p>
          <p>
            To change the matching choices, start a new merge and load the original base and import
            files again.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
