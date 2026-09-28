import {
  ActionButton,
  Alert,
  Details,
  DetailsContent,
  DetailsSummary,
  EmptyState,
  NativeSelect,
  NativeSelectOption,
  Pager,
  SidebarSection,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@osmix/ui";
import { DownloadIcon } from "lucide-react";
import type { OsmConflationOutcomeReport } from "osmix";
import { useId, useState } from "react";

import { OUTCOME_LABEL, OUTCOMES, planReasonLabel } from "../lib/merge-plan-workflow";
import type { MergeCompletion } from "../state/merge-outcome";
import { ConflationWayRemovalPreview } from "./conflation-way-removal";

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

type FeatureFilter = "unresolved" | "skipped" | "all";

function FeatureOutcomes({ outcome }: { outcome: OsmConflationOutcomeReport }) {
  const filterId = useId();
  const [filter, setFilter] = useState<FeatureFilter>(
    outcome.summary.unresolvedFeatures > 0 ? "unresolved" : "all",
  );
  const [requestedPage, setPage] = useState(0);
  const features = outcome.features.filter(
    (feature) =>
      filter === "all" || (filter === "unresolved" ? feature.unresolved !== null : feature.skipped),
  );
  const pages = Math.ceil(features.length / PAGE_SIZE);
  const page = Math.min(requestedPage, Math.max(0, pages - 1));
  const filterOptions: readonly { value: FeatureFilter; label: string }[] = [
    {
      value: "unresolved",
      label: `Unresolved (${outcome.summary.unresolvedFeatures.toLocaleString()})`,
    },
    {
      value: "skipped",
      label: `Intentionally skipped (${outcome.summary.skippedFeatures.toLocaleString()})`,
    },
    { value: "all", label: `All considered (${outcome.summary.features.toLocaleString()})` },
  ];
  return (
    <Details defaultOpen={false}>
      <DetailsSummary>Imported feature outcomes</DetailsSummary>
      <DetailsContent>
        <div className="flex flex-col gap-1 p-inset">
          <label htmlFor={filterId}>Show features</label>
          <NativeSelect
            className="w-full"
            id={filterId}
            value={filter}
            onChange={(event) => {
              const next = filterOptions.find((option) => option.value === event.target.value);
              if (!next) return;
              setFilter(next.value);
              setPage(0);
            }}
          >
            {filterOptions.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {features.length === 0 ? (
          <EmptyState>No imported features in this category</EmptyState>
        ) : (
          <ul className="divide-y border-t" aria-label="Imported feature outcome details">
            {features.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((feature) => (
              <li
                key={`${feature.entityType}:${feature.sourceId}`}
                className="flex flex-col gap-1 px-inset py-2 wrap-break-word"
              >
                <p className="font-semibold">
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
                    {feature.reasons.map(planReasonLabel).join("; ")}
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
        <Pager
          className="border-t px-inset py-2"
          label="Imported feature outcome pages"
          page={page}
          pageCount={pages}
          onPageChange={setPage}
        />
      </DetailsContent>
    </Details>
  );
}

function UncopiedTags({ outcome }: { outcome: OsmConflationOutcomeReport }) {
  const tagSelectId = useId();
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
        <p className="p-inset">
          Counts include imported features with a value for the selected tag. Values not copied to a
          base target can still be present on ordinary imported additions.
        </p>
        <div className="flex flex-col gap-1 border-t p-inset">
          <label htmlFor={tagSelectId}>Selected tag</label>
          <NativeSelect
            className="w-full font-mono"
            id={tagSelectId}
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setPage(0);
            }}
          >
            {outcome.tags.map((tag) => (
              <NativeSelectOption key={tag.key} value={tag.key}>
                {tag.key}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {tag ? (
          <>
            <CountTable
              label={`Outcomes for ${tag.key}`}
              className="border-t"
              rows={[
                { label: "Imported features with this tag", count: tag.presentFeatures },
                { label: "Copied to a base target", count: tag.copiedFeatures },
                { label: "Already equal when considered", count: tag.alreadyEqualFeatures },
                { label: "Satisfied by another copy", count: tag.satisfiedByOtherCopyFeatures },
                { label: "Not copied", count: tag.uncopied.length },
              ]}
            />
            <ul className="divide-y border-t" aria-label="Selected tag not copied details">
              {tag.uncopied.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((feature) => (
                <li
                  key={`${feature.entityType}:${feature.sourceId}`}
                  className="flex flex-col gap-1 px-inset py-2 wrap-break-word"
                >
                  <p className="font-semibold">
                    Imported {feature.entityType} {feature.sourceId}
                  </p>
                  <p>{TAG_REASON_LABELS[feature.reason]}</p>
                  {feature.reasons.length ? (
                    <p className="text-muted-foreground">
                      {feature.reasons.map(planReasonLabel).join("; ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {tag.uncopied.length === 0 ? (
              <EmptyState>Every present value is satisfied in the result</EmptyState>
            ) : null}
            <Pager
              className="border-t px-inset py-2"
              label="Selected tag detail pages"
              page={page}
              pageCount={pages}
              onPageChange={setPage}
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
  const outcome = completion.plan.matching?.outcome ?? null;
  const summary = outcome?.summary;
  const features = completion.plan.summary.features;
  const undecided = features["needs-decision"];
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadReport = async () => {
    setDownloadError(null);
    try {
      await onDownloadReport();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setDownloadError(
        `The report could not be saved. ${error instanceof Error ? error.message : "Try exporting it again."}`,
      );
    }
  };

  return (
    <SidebarSection
      flush
      aria-label="Merge completion summary"
      title={`Merge complete${undecided > 0 ? " · undecided proposals were left out" : ""}`}
    >
      <p className="px-inset pb-inset">
        You can export the merged dataset. This report describes the completed run.
      </p>
      <CountTable
        label="Imported features by outcome"
        rows={OUTCOMES.filter((key) => features[key] > 0).map((key) => ({
          label: OUTCOME_LABEL[key],
          count: features[key],
        }))}
      />
      {undecided > 0 ? (
        <p className="p-inset">
          Proposals for {undecided.toLocaleString()} imported{" "}
          {undecided === 1 ? "feature were" : "features were"} waiting for a decision and were left
          out; the features themselves were still added.
        </p>
      ) : null}
      {summary ? (
        <>
          <CountTable
            label="Applied matching actions"
            className="border-t"
            rows={[
              { label: "Tag-copy actions", count: summary.tagCopyActions },
              { label: "Attribute values updated", count: summary.copiedTagValues },
              { label: "Network connections", count: summary.networkAttachmentActions },
              { label: "Replaced points removed", count: summary.removedConnectionOrphanNodes },
              ...(summary.wayRemovalActions !== undefined
                ? [
                    { label: "Imported ways removed", count: summary.wayRemovalActions },
                    { label: "Orphan points removed", count: summary.removedOrphanNodes ?? 0 },
                  ]
                : []),
              {
                label: "Imported features unresolved",
                count: summary.unresolvedFeatures,
                strong: true,
              },
            ]}
          />
          <div className="flex flex-col gap-2 p-inset">
            <p>
              Imported features considered for matching: {summary.features.toLocaleString()}.{" "}
              Intentionally skipped: {summary.skippedFeatures.toLocaleString()}. Resolved without
              additional matching actions: {summary.unchangedFeatures.toLocaleString()}.
            </p>
            <p>
              Actions count actual changes from matching, after the ordinary merge. One feature can
              have several actions, or an applied action and another unresolved action.
            </p>
            <p>
              These details record matching. Crossings planned after it can make more connections or
              change the junction IDs used by a way.
            </p>
            {summary.features === 0 ? (
              <p>
                No imported features were considered for matching with these options. Ordinary merge
                rules still applied.
              </p>
            ) : null}
          </div>
          {summary.unresolvedFeatures > 0 ? (
            <CountTable
              label="Unresolved imported features"
              className="border-t"
              rows={[
                { label: "Multiple possible targets", count: summary.ambiguousFeatures },
                { label: "Blocked", count: summary.blockedFeatures },
                { label: "No matching target", count: summary.unmatchedFeatures },
                { label: "Choice still needed", count: summary.reviewFeatures },
              ]}
            />
          ) : null}
        </>
      ) : (
        <p className="p-inset">
          Imported-data matching was not enabled. The ordinary merge has completed.
        </p>
      )}
      <p className="p-inset">
        Skipping or leaving a match unresolved does not itself discard the import. Explicit way
        removals are listed separately. Other additions remain under ordinary merge rules; exact
        reconciliation can represent an imported feature with a base ID.
      </p>
      {outcome ? (
        <>
          <FeatureOutcomes outcome={outcome} />
          <UncopiedTags outcome={outcome} />
          {outcome.features.some((feature) => feature.wayRemoval) ? (
            <ConflationWayRemovalPreview outcome={outcome} applied />
          ) : null}
        </>
      ) : null}
      <div className="flex flex-col gap-2 border-t p-inset">
        <ActionButton icon={<DownloadIcon />} variant="outline" onAction={downloadReport}>
          Export merge report (JSON)
        </ActionButton>
        {downloadError ? <Alert variant="destructive">{downloadError}</Alert> : null}
        <p className="wrap-break-word text-muted-foreground">
          Inputs: {completion.inputs.baseName} + {completion.inputs.patchName}.
        </p>
        <p>
          To change the matching choices, start a new merge and load the original base and import
          files again.
        </p>
      </div>
    </SidebarSection>
  );
}

/** Label–count rows as a flush table, the counts right-aligned so they line up. */
function CountTable({
  label,
  rows,
  className,
}: {
  label: string;
  rows: { label: string; count: number; strong?: boolean }[];
  className?: string;
}) {
  return (
    <Table aria-label={label} className={className}>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className={row.strong ? "font-semibold" : undefined}>{row.label}</TableCell>
            <TableCell numeric className={row.strong ? "font-semibold" : undefined}>
              {row.count.toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
