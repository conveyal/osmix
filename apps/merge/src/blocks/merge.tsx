import {
  useOsmFile,
  mergedOsmRefreshRetryId,
  showSaveFilePickerWithFallback,
  changesetStatsAtom,
  Log,
  selectedEntityAtom,
  selectOsmEntityAtom,
  osmLoadingAbortControllerAtom,
} from "@osmix/app-core";
import { useOsmixRemote } from "@osmix/app-core";
import {
  ActionButton,
  Details,
  DetailsContent,
  DetailsSummary,
  LoadingState,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  cn,
} from "@osmix/ui";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  ArrowLeft,
  ArrowRightIcon,
  CheckCircle,
  ChevronRightIcon,
  DownloadIcon,
  FastForwardIcon,
  FileDiff,
  MaximizeIcon,
  MergeIcon,
  SaveIcon,
  SearchCodeIcon,
  SkipForwardIcon,
  StopCircleIcon,
} from "lucide-react";
import {
  changeStatsSummary,
  type OsmConflationBulkDecisionRequest,
  type OsmConflationDecision,
  type OsmConflationCandidateView,
} from "osmix";
import { Suspense, useMemo, useState } from "react";

import {
  type AutomaticMergeProgressState,
  CONFLATION_AUTOMATIC_MERGE_STEPS,
  EXACT_AUTOMATIC_MERGE_STEPS,
  LiveAutomaticMergeProgress,
} from "../components/automatic-merge-progress";
import { ConflationConfig } from "../components/conflation-config";
import { ConflationReview } from "../components/conflation-review";
import { ConflationRoutingDiagnostics } from "../components/conflation-routing-diagnostics";
import { ConflationWayRemovalPreview } from "../components/conflation-way-removal";
import EntityDetails from "../components/entity-details";
import { FullIndexRequired, hasFullNodeIndex } from "../components/full-index-required";
import { BackToMatching, MatchingReviewProblem } from "../components/matching-review-recovery";
import { MergeCompletionSummary } from "../components/merge-completion-summary";
import { MergeStepGuide, type MergeStepGuideId } from "../components/merge-step-guide";
import ChangesSummary, {
  ChangesExpandableList,
  ChangesFilters,
  ChangesPagination,
} from "../components/osm-changes-summary";
import OsmInfoTable from "../components/osm-info-table";
import { OsmInputCardHeader } from "../components/osm-input-card-header";
import { StepActions } from "../components/step-actions";
import StoredOsmList from "../components/stored-osm-list";
import { useFlyToEntity, useFlyToOsmBounds } from "../hooks/map";
import {
  firstInvalidConflationInputId,
  toOsmConflationOptions,
  validateConflationForm,
} from "../lib/conflation-workflow";
import { writeJsonArray, writeJsonReport } from "../lib/json-download";
import {
  matchingReviewIssue,
  returnToMatchingReview,
  type MatchingReviewIssue,
} from "../lib/matching-review";
import {
  completeMergeOptions,
  committedMutationOsmId,
  finalizeVerifiedMerge,
  INTERSECTION_OPTIONS,
  recoverConflationRunAllFailure,
  runConflationAllSteps,
  verifiedBaseMergeOptions,
  WITHIN_DATASET_DIAGNOSTIC_OPTIONS,
} from "../lib/merge-workflow";
import { BASE_OSM_KEY, PATCH_OSM_KEY } from "../settings";
import {
  conflationCandidateFilterAtom,
  conflationCandidatePageAtom,
  conflationCandidatePageIndexAtom,
  conflationComparisonAtom,
  conflationDecisionsAtom,
  conflationFormAtom,
  conflationRoutingDiagnosticsAtom,
  conflationSummaryAtom,
  resetConflationReviewAtom,
} from "../state/conflation";
import {
  generatedMergeOutcomeAtom,
  mergeCompletionAtom,
  mergeRunInputsAtom,
  mergeStepIndexAtom as stepIndexAtom,
  pendingMergedRefreshAtom,
  updateMergeOutcomeAtom,
} from "../state/merge-outcome";
import { mergeAbortControllerAtom } from "../state/status";
const STEPS = [
  "select-osm-pbf-files",
  "inspect-base-osm",
  "review-changeset",
  "inspect-patch-osm",
  "review-changeset",
  "direct-merge",
  "review-changeset",
  "match-imported-data",
  "deduplicate-nodes",
  "review-changeset",
  "create-intersections",
  "review-changeset",
  "inspect-final-osm",
  "run-all-steps",
] as const;

type ChangesetReviewContext =
  | { kind: "base-diagnostic" }
  | { kind: "patch-diagnostic" }
  | { kind: "direct-preview" }
  | { kind: "cumulative"; exactReconciliation: boolean; matching: boolean }
  | { kind: "intersections" };

const changesetReviewContextAtom = atom<ChangesetReviewContext>({
  kind: "cumulative",
  exactReconciliation: true,
  matching: false,
});
const CONFLATION_PAGE_SIZE = 10;
const stepAtom = atom<(typeof STEPS)[number] | null>((get) => {
  const stepIndex = get(stepIndexAtom);
  return STEPS[stepIndex];
});

const toStem = (name: string | null | undefined) => {
  if (!name) return "dataset";
  return (
    name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "dataset"
  );
};

const makeMergedDownloadName = (baseName?: string | null, patchName?: string | null) => {
  const baseStem = toStem(baseName);
  const patchStem = toStem(patchName);
  const combined = `osmix-merged-${baseStem}-with-${patchStem}`;
  return `${combined.slice(0, 120)}.pbf`;
};

function reviewGuideId(context: ChangesetReviewContext): MergeStepGuideId {
  switch (context.kind) {
    case "base-diagnostic":
      return "review-base-diagnostic";
    case "patch-diagnostic":
      return "review-patch-diagnostic";
    case "direct-preview":
      return "review-direct";
    case "cumulative":
      return context.exactReconciliation
        ? "review-cumulative-exact"
        : "review-cumulative-without-exact";
    case "intersections":
      return "review-intersections";
  }
}

function reviewStepTitle(context: ChangesetReviewContext): string {
  switch (context.kind) {
    case "base-diagnostic":
      return "Review base diagnostic";
    case "patch-diagnostic":
      return "Review patch diagnostic";
    case "direct-preview":
      return "Review direct merge";
    case "cumulative":
      return context.exactReconciliation
        ? "Review cumulative merge"
        : "Review merge without exact reconciliation";
    case "intersections":
      return "Review intersections";
  }
}

function reviewChangesetTitle(context: ChangesetReviewContext): string {
  switch (context.kind) {
    case "base-diagnostic":
      return "Base diagnostic candidates";
    case "patch-diagnostic":
      return "Patch diagnostic candidates";
    case "direct-preview":
      return "Direct-merge preview";
    case "cumulative":
      return context.exactReconciliation
        ? "Cumulative merge changeset"
        : "Merge changeset without exact reconciliation";
    case "intersections":
      return "Intersection changeset";
  }
}

export default function MergeBlock() {
  const remote = useOsmixRemote();
  const base = useOsmFile(BASE_OSM_KEY);
  const patch = useOsmFile(PATCH_OSM_KEY);
  const completion = useAtomValue(mergeCompletionAtom);
  const generatedOutcome = useAtomValue(generatedMergeOutcomeAtom);
  const runInputs = useAtomValue(mergeRunInputsAtom);
  const [pendingMergedRefresh, setPendingMergedRefresh] = useAtom(pendingMergedRefreshAtom);
  const updateMergeOutcome = useSetAtom(updateMergeOutcomeAtom);
  const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom);
  const [changesetReviewContext, setChangesetReviewContext] = useAtom(changesetReviewContextAtom);
  const [conflationForm] = useAtom(conflationFormAtom);
  const [conflationSummary, setConflationSummary] = useAtom(conflationSummaryAtom);
  const [conflationCandidatePage, setConflationCandidatePage] = useAtom(
    conflationCandidatePageAtom,
  );
  const [conflationCandidatePageIndex, setConflationCandidatePageIndex] = useAtom(
    conflationCandidatePageIndexAtom,
  );
  const [conflationCandidateFilter, setConflationCandidateFilter] = useAtom(
    conflationCandidateFilterAtom,
  );
  const [isConflationFilterPending, setIsConflationFilterPending] = useState(false);
  const [matchingIssue, setMatchingIssue] = useState<MatchingReviewIssue | null>(null);
  const [changesDownloadError, setChangesDownloadError] = useState<string | null>(null);
  const [automaticMergeProgress, setAutomaticMergeProgress] =
    useState<AutomaticMergeProgressState | null>(null);
  const [conflationDecisions, setConflationDecisions] = useAtom(conflationDecisionsAtom);
  const [conflationRoutingDiagnostics, setConflationRoutingDiagnostics] = useAtom(
    conflationRoutingDiagnosticsAtom,
  );
  const resetConflationReview = useSetAtom(resetConflationReviewAtom);
  const setConflationComparison = useSetAtom(conflationComparisonAtom);
  const flyToEntity = useFlyToEntity();
  const flyToOsmBounds = useFlyToOsmBounds();
  const selectedEntity = useAtomValue(selectedEntityAtom);
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const [stepIndex, setStepIndex] = useAtom(stepIndexAtom);
  const [mergeAbortController, setMergeAbortController] = useAtom(mergeAbortControllerAtom);
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);

  const moveStep = (direction: -1 | 1) => {
    selectEntity(null, null);
    setConflationComparison({ type: "FeatureCollection", features: [] });
    setStepIndex((current) => {
      let next = current + direction;
      if (STEPS[next] === "match-imported-data" && !conflationForm.enabled) {
        next += direction;
      }
      return next;
    });
  };
  const prevStep = () => {
    moveStep(-1);
  };
  const nextStep = () => {
    moveStep(1);
  };
  const goToStep = (step: number | (typeof STEPS)[number]) => {
    const stepIndex = typeof step === "number" ? step : STEPS.indexOf(step);
    selectEntity(null, null);
    setConflationComparison({ type: "FeatureCollection", features: [] });
    setStepIndex(stepIndex);
  };
  const showVerifiedMergeResult = () => {
    updateMergeOutcome({ type: "complete" });
    finalizeVerifiedMerge(
      () => patch.setOsm(null),
      () => goToStep("inspect-final-osm"),
    );
  };
  const completesVerifiedMerge = STEPS[stepIndex - 1] === "create-intersections";
  const startStepTask = async (message: string, fn: () => Promise<string>) => {
    const task = Log.startTask(message);
    try {
      const endMessage = await fn();
      task.end(endMessage);
      nextStep();
    } catch (error) {
      task.end(`Task failed: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    }
  };
  const conflationValidationMessage = validateConflationForm(conflationForm);
  const canStartConfiguredMerge = () => {
    const invalidInputId = firstInvalidConflationInputId(conflationForm);
    if (!invalidInputId) return true;
    document.getElementById(invalidInputId)?.focus();
    return false;
  };
  const conflationOptions = conflationValidationMessage
    ? undefined
    : toOsmConflationOptions(conflationForm);
  const requiresRemovalReview = conflationForm.enabled && conflationForm.allowWayRemoval;
  const baseFileName = base.file?.name ?? base.fileInfo?.fileName;
  const patchFileName = patch.file?.name ?? patch.fileInfo?.fileName;
  const beginMergeOutcome = () =>
    updateMergeOutcome({
      type: "begin",
      inputs: {
        baseName: baseFileName ?? "Base dataset",
        patchName: patchFileName ?? "Imported dataset",
        matchingEnabled: Boolean(conflationOptions),
      },
    });

  const resetMergeDerivedState = () => {
    setChangesDownloadError(null);
    setPendingMergedRefresh(null);
    updateMergeOutcome({ type: "reset" });
    setMatchingIssue(null);
    setChangesetStats(null);
    resetConflationReview();
    selectEntity(null, null);
  };

  const clearBaseOsm = async () => {
    resetMergeDerivedState();
    await base.loadOsmFile(null);
  };

  const clearPatchOsm = async () => {
    resetMergeDerivedState();
    await patch.loadOsmFile(null);
  };

  const loadConflationPage = async (page: number) => {
    if (!base.osm) throw Error("Base OSM is not loaded");
    let result = await remote.getConflationPage(base.osm.id, page, CONFLATION_PAGE_SIZE, {
      groupBySource: true,
    });
    const lastPage = Math.max(0, result.totalPages - 1);
    if (page > lastPage) {
      result = await remote.getConflationPage(base.osm.id, lastPage, CONFLATION_PAGE_SIZE, {
        groupBySource: true,
      });
    }
    setConflationCandidatePageIndex(result.page);
    setConflationCandidatePage(result);
  };

  const updateConflationFilter = async (filter: typeof conflationCandidateFilter) => {
    if (!base.osm) throw Error("Base OSM is not loaded");
    const previousFilter = conflationCandidateFilter;
    setConflationCandidateFilter(filter);
    setIsConflationFilterPending(true);
    try {
      await remote.setConflationFilter(base.osm.id, filter);
      await loadConflationPage(0);
    } catch (error) {
      // Keep the visible controls aligned with the still-displayed page when a
      // worker failure prevents the requested filter from being applied.
      try {
        await remote.setConflationFilter(base.osm.id, previousFilter);
      } catch {
        // Preserve the original refresh error; a later page request will surface
        // any worker recovery failure through the ordinary error channel.
      }
      setConflationCandidateFilter(previousFilter);
      throw error;
    } finally {
      setIsConflationFilterPending(false);
    }
  };

  const invalidateMatchingPreview = () => {
    updateMergeOutcome({ type: "invalidate-preview" });
    if (changesetReviewContext.kind === "cumulative" && changesetReviewContext.matching) {
      setChangesetStats(null);
    }
    setConflationRoutingDiagnostics(null);
  };

  const withMatchingReviewError = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      setMatchingIssue(matchingReviewIssue(error));
    }
  };

  const saveConflationSourceChoice = (
    source: Pick<OsmConflationCandidateView, "entityType" | "sourceId">,
    decision: OsmConflationDecision | null,
  ) =>
    withMatchingReviewError(async () => {
      if (!base.osm) throw Error("Base OSM is not loaded");
      const result = await remote.setConflationSourceDecision(
        base.osm.id,
        { entityType: source.entityType, sourceId: source.sourceId },
        decision,
      );
      setConflationDecisions(result.decisions);
      setConflationSummary(result.summary);
      setMatchingIssue(null);
      invalidateMatchingPreview();
      await loadConflationPage(conflationCandidatePageIndex);
    });

  const updateConflationDecision = async (decision: OsmConflationDecision) => {
    const candidate = conflationCandidatePage?.candidates.find(
      (candidate) => candidate.id === decision.candidateId,
    );
    if (!candidate) {
      setMatchingIssue({
        message: "This match is no longer on the current page. Refresh the candidates.",
      });
      return;
    }
    await saveConflationSourceChoice(candidate, decision);
  };

  const returnToMatching = () =>
    withMatchingReviewError(() =>
      returnToMatchingReview({
        filter: conflationCandidateFilter,
        page: conflationCandidatePageIndex,
        issue: matchingIssue,
        onFilterChange: updateConflationFilter,
        onPageChange: loadConflationPage,
        onReturn: () => goToStep("match-imported-data"),
      }),
    );

  const resetConflationDecision = (candidateId: string) =>
    withMatchingReviewError(async () => {
      if (!base.osm) throw Error("Base OSM is not loaded");
      const decisions = conflationDecisions.filter(
        (decision) => decision.candidateId !== candidateId,
      );
      const summary = await remote.setConflationDecisions(base.osm.id, decisions);
      setConflationDecisions(decisions);
      setConflationSummary(summary);
      setMatchingIssue(null);
      invalidateMatchingPreview();
      await loadConflationPage(conflationCandidatePageIndex);
    });

  const updateConflationBulkDecision = (request: OsmConflationBulkDecisionRequest) =>
    withMatchingReviewError(async () => {
      if (!base.osm) throw Error("Base OSM is not loaded");
      const result = await remote.applyConflationBulkDecision(base.osm.id, request);
      setConflationDecisions(result.decisions);
      setConflationSummary(result.summary);
      if (result.preview.changedCandidates > 0) invalidateMatchingPreview();
      await loadConflationPage(0);
      Log.addMessage(
        `Updated ${result.preview.changedCandidates.toLocaleString()} filtered conflation decisions`,
      );
      setMatchingIssue(null);
    });

  const generateVerifiedChangeset = async (reconcile: boolean) => {
    if (!base.osm || !patch.osm) throw Error("Missing data to generate changes");
    if (conflationOptions) {
      setMatchingIssue(null);
      try {
        if (!conflationSummary) {
          throw Error("Discover and review imported-data match candidates first");
        }
        const result = await remote.generateConflationChangeset(
          base.osm.id,
          verifiedBaseMergeOptions(reconcile),
        );
        setChangesetReviewContext({
          kind: "cumulative",
          exactReconciliation: reconcile,
          matching: true,
        });
        setChangesetStats(result.stats);
        updateMergeOutcome({ type: "generated", outcome: result.outcome });
        setConflationRoutingDiagnostics(result.routing);
        return changeStatsSummary(result.stats);
      } catch (error) {
        setMatchingIssue(matchingReviewIssue(error));
        throw error;
      }
    }

    const result = await remote.generateChangeset(
      base.osm.id,
      patch.osm.id,
      verifiedBaseMergeOptions(reconcile),
    );
    setChangesetReviewContext({
      kind: "cumulative",
      exactReconciliation: reconcile,
      matching: false,
    });
    setConflationRoutingDiagnostics(null);
    setChangesetStats(result);
    updateMergeOutcome({ type: "generated", outcome: null });
    return changeStatsSummary(result);
  };

  const downloadJsonChanges = async () => {
    setChangesDownloadError(null);
    try {
      if (!changesetStats) return;
      const fileHandle = await showSaveFilePickerWithFallback(
        {
          suggestedName: "osm-changes.json",
        },
        () => {
          Log.addMessage("Native save picker unavailable, falling back to browser download");
        },
      );
      if (!fileHandle) return;
      const stream = await fileHandle.createWritable();

      const pageSize = 100_000;
      const osmId = changesetStats.osmId;
      const task = Log.startTask(`Converting ${changesetStats.totalChanges} changes to JSON`);
      async function* changePages() {
        for (let page = 0; ; page++) {
          const result = await remote.getChangesetPage(osmId, page, pageSize);
          if (!result.changes || result.changes.length === 0) return;
          yield result.changes;
        }
      }
      try {
        await writeJsonArray(stream, changePages());
      } catch (error) {
        task.end(
          `JSON download failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          "error",
        );
        throw error;
      }
      task.end("Changeset converted to JSON");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setChangesDownloadError(
        `Changes could not be saved. ${error instanceof Error ? error.message : "Try downloading again."}`,
      );
    }
  };

  const downloadOutcomeReport = async () => {
    if (!completion) return;
    const fileHandle = await showSaveFilePickerWithFallback({
      suggestedName: "osmix-merge-outcome.json",
    });
    if (!fileHandle) return;
    const stream = await fileHandle.createWritable();
    await writeJsonReport(stream, { format: "osmix-merge-outcome", version: 1, ...completion });
  };

  const startNewMerge = async () => {
    await Promise.all([base.loadOsmFile(null), patch.loadOsmFile(null)]);
    resetMergeDerivedState();
    goToStep("select-osm-pbf-files");
  };

  const refreshMergedResult = async (
    osmId: string,
    fileName: string | undefined,
    finishOnRetry: boolean,
    synchronize = false,
  ) => {
    const pending = { osmId, fileName, finishOnRetry, synchronize };
    let needsSynchronization = synchronize;
    setPendingMergedRefresh(pending);
    try {
      if (synchronize) await remote.synchronizeDataset(osmId);
      // Once synchronization succeeds, a later rename/refresh retry uses its surviving ID.
      needsSynchronization = false;
      await base.setMergedOsm(osmId, fileName);
      updateMergeOutcome({ type: "refreshed" });
      setPendingMergedRefresh(null);
    } catch (error) {
      setPendingMergedRefresh({
        ...pending,
        synchronize: needsSynchronization,
        osmId: mergedOsmRefreshRetryId(error, osmId),
        error:
          error instanceof Error ? error.message : "The merged dataset could not be refreshed.",
      });
      throw error;
    }
  };

  const retryMergedRefresh = async () => {
    if (!pendingMergedRefresh) return;
    try {
      await refreshMergedResult(
        pendingMergedRefresh.osmId,
        pendingMergedRefresh.fileName,
        pendingMergedRefresh.finishOnRetry,
        pendingMergedRefresh.synchronize,
      );
      if (pendingMergedRefresh.finishOnRetry) showVerifiedMergeResult();
    } catch {
      // The retained refresh state exposes a retry without reapplying a changeset.
    }
  };

  const applyChanges = async () => {
    if (!changesetStats) throw Error("Changeset stats are not loaded");
    let synchronize = false;
    try {
      await remote.applyChangesAndReplace(changesetStats.osmId);
    } catch (error) {
      if (committedMutationOsmId(error, "applyChangesAndReplace") !== changesetStats.osmId) {
        throw error;
      }
      synchronize = true;
      Log.addMessage("Changes were applied; refreshing worker copies before continuing.");
    }
    updateMergeOutcome({
      type: changesetReviewContext.kind === "cumulative" ? "applied" : "result-mutated",
    });
    setChangesetStats(null);
    return { osmId: changesetStats.osmId, synchronize };
  };

  const hasZeroChanges = useMemo(() => {
    if (!changesetStats) return true;
    return changesetStats.totalChanges === 0;
  }, [changesetStats]);
  const isDiagnosticReview =
    changesetReviewContext.kind === "base-diagnostic" ||
    changesetReviewContext.kind === "patch-diagnostic";
  const isDirectPreviewReview = changesetReviewContext.kind === "direct-preview";

  const baseNeedsFull = base.osmInfo !== null && !hasFullNodeIndex(base.osmInfo);
  const patchNeedsFull = patch.osmInfo !== null && !hasFullNodeIndex(patch.osmInfo);
  if (baseNeedsFull || patchNeedsFull) {
    return (
      <div className="flex flex-col gap-4">
        <FullIndexRequired operation="Merge and duplicate detection" osmFile={base} />
        <FullIndexRequired operation="Merge and duplicate detection" osmFile={patch} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {pendingMergedRefresh?.error ? (
        <Card role="alert">
          <CardHeader>The merged dataset needs to be refreshed</CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p>{pendingMergedRefresh.error}</p>
            <p>
              The worker already applied the changes. Refresh the displayed result before continuing
              or downloading.
            </p>
            <ActionButton onAction={retryMergedRefresh}>Refresh merged dataset</ActionButton>
            <p>
              If refreshing cannot recover the dataset, reload this page and load both original
              input files to start again.
            </p>
          </CardContent>
        </Card>
      ) : null}
      <Step step="select-osm-pbf-files" title="Select merge inputs and options" guideId="select">
        <Card>
          <CardHeader>Merge pipeline</CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ol className="list-decimal list-inside">
              <li>Optionally inspect each input for possible internal duplicates</li>
              <li>Add patch entities and apply same-ID patch updates</li>
              <li>Optionally match nearby imported entities</li>
              <li>Optionally reconcile exact, compatible entities across the inputs</li>
              <li>Create safe intersections where eligible ways cross</li>
              <li>Validate topology before exposing the merged result</li>
            </ol>
            <p>
              The reviewed workflow pauses at diagnostic and changeset checkpoints. The automatic
              workflow skips those checkpoints but uses the same safety validation.
            </p>
          </CardContent>
        </Card>

        <Card>
          <OsmInputCardHeader
            fileName={baseFileName}
            kind="base"
            loaded={Boolean(base.osm)}
            onClear={clearBaseOsm}
            onDownload={base.downloadOsm}
            title="Base OSM — authoritative existing dataset"
          />
          <CardContent className="p-0">
            {!base.osm ? (
              <StoredOsmList
                osmKey={BASE_OSM_KEY}
                loadFailure={base.loadFailure}
                onDismissLoadFailure={base.clearLoadFailure}
                onReloadView={base.reloadWithViewProfile}
                openOsmPbfUrl={async (url) => {
                  const abortController = new AbortController();
                  setLoadingState({
                    controller: abortController,
                    osmKey: BASE_OSM_KEY,
                  });
                  setChangesetStats(null);
                  resetConflationReview();
                  selectEntity(null, null);
                  try {
                    const osmInfo = await base.loadOsmPbfUrl(url, abortController.signal);
                    if (osmInfo) flyToOsmBounds(osmInfo);
                    return osmInfo;
                  } finally {
                    setLoadingState(null);
                  }
                }}
                openOsmFile={async (file, fileType) => {
                  const abortController = new AbortController();
                  setLoadingState({
                    controller: abortController,
                    osmKey: BASE_OSM_KEY,
                  });
                  setChangesetStats(null);
                  resetConflationReview();
                  selectEntity(null, null);
                  try {
                    const osmInfo =
                      typeof file === "string"
                        ? await base.loadFromStorage(file, abortController.signal)
                        : await base.loadOsmFile(file, fileType, abortController.signal);
                    if (osmInfo) flyToOsmBounds(osmInfo);
                    return osmInfo;
                  } finally {
                    setLoadingState(null);
                  }
                }}
              />
            ) : (
              <OsmInfoTable
                defaultOpen={false}
                osm={base.osm}
                file={base.file}
                fileInfo={base.fileInfo}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <OsmInputCardHeader
            fileName={patchFileName}
            kind="patch"
            loaded={Boolean(patch.osm)}
            onClear={clearPatchOsm}
            onDownload={patch.downloadOsm}
            title="Patch OSM — imported additions and updates"
          />
          <CardContent className="p-0">
            {!patch.osm ? (
              <StoredOsmList
                osmKey={PATCH_OSM_KEY}
                loadFailure={patch.loadFailure}
                onDismissLoadFailure={patch.clearLoadFailure}
                onReloadView={patch.reloadWithViewProfile}
                openOsmPbfUrl={async (url) => {
                  const abortController = new AbortController();
                  setLoadingState({
                    controller: abortController,
                    osmKey: PATCH_OSM_KEY,
                  });
                  try {
                    const osmInfo = await patch.loadOsmPbfUrl(url, abortController.signal);
                    if (osmInfo) flyToOsmBounds(osmInfo);
                    return osmInfo;
                  } finally {
                    setLoadingState(null);
                  }
                }}
                openOsmFile={async (file) => {
                  const abortController = new AbortController();
                  setLoadingState({
                    controller: abortController,
                    osmKey: PATCH_OSM_KEY,
                  });
                  try {
                    const osmInfo =
                      typeof file === "string"
                        ? await patch.loadFromStorage(file, abortController.signal)
                        : await patch.loadOsmFile(file, undefined, abortController.signal);
                    if (osmInfo) flyToOsmBounds(osmInfo);
                    return osmInfo;
                  } finally {
                    setLoadingState(null);
                  }
                }}
              />
            ) : (
              <OsmInfoTable
                defaultOpen={false}
                osm={patch.osm}
                file={patch.file}
                fileInfo={patch.fileInfo}
              />
            )}
          </CardContent>
        </Card>

        <ConflationConfig />

        <div
          className={cn(
            "flex flex-col gap-4",
            !base.osm || !patch.osm ? "opacity-50 pointer-events-none" : "",
          )}
        >
          <Item
            render={
              <button
                type="button"
                disabled={!base.osm || !patch.osm}
                onClick={() => {
                  if (!canStartConfiguredMerge()) return;
                  beginMergeOutcome();
                  setChangesetStats(null);
                  resetConflationReview();
                  nextStep();
                }}
              />
            }
          >
            <ItemMedia>
              <CheckCircle />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Review each merge stage</ItemTitle>
              <ItemDescription>
                Inspect diagnostics and approve each changeset before the in-memory base changes.
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRightIcon />
            </ItemActions>
          </Item>
          <Item
            render={
              <button
                type="button"
                disabled={!base.osm || !patch.osm || requiresRemovalReview}
                aria-describedby={
                  requiresRemovalReview ? "removal-manual-review-required" : undefined
                }
                onClick={async () => {
                  if (requiresRemovalReview) return;
                  if (!canStartConfiguredMerge()) return;
                  beginMergeOutcome();
                  const automaticSteps = conflationOptions
                    ? CONFLATION_AUTOMATIC_MERGE_STEPS
                    : EXACT_AUTOMATIC_MERGE_STEPS;
                  setAutomaticMergeProgress({
                    currentStepId: automaticSteps[0].id,
                    steps: automaticSteps,
                  });
                  goToStep("run-all-steps");

                  const abortController = new AbortController();
                  setMergeAbortController(abortController);

                  const task = Log.startTask("Running automatic merge, please wait...");
                  if (!base.osm) throw Error("Base OSM is not loaded");
                  if (!patch.osm) throw Error("Patch OSM is not loaded");
                  const baseOsmId = base.osm.id;
                  const patchOsmId = patch.osm.id;
                  const mergedName = makeMergedDownloadName(
                    base.fileInfo?.fileName,
                    patch.fileInfo?.fileName,
                  );
                  // Track transaction boundaries separately: each failure state has a different
                  // safe recovery path and we cannot roll back an applied worker changeset.
                  let conflationDiscoveryCompleted = false;
                  let conflationBaseApplied = false;
                  let mergePipelineCompleted = false;
                  let completedOsmId = baseOsmId;

                  try {
                    setChangesetStats(null);
                    resetConflationReview();
                    if (conflationOptions) {
                      const result = await runConflationAllSteps({
                        baseOsmId,
                        conflation: conflationOptions,
                        isCancelled: () => abortController.signal.aborted,
                        onBaseApplied: () => {
                          updateMergeOutcome({ type: "applied" });
                          conflationBaseApplied = true;
                        },
                        onIntersectionsApplied: () => {
                          mergePipelineCompleted = true;
                        },
                        onDiscovered: (summary) => {
                          conflationDiscoveryCompleted = true;
                          setConflationSummary(summary);
                          const unresolved = summary.review + summary.blocked + summary.unmatched;
                          Log.addMessage(
                            `Imported-data matching found ${summary.automatic.toLocaleString()} automatic and ${unresolved.toLocaleString()} unresolved candidates`,
                          );
                        },
                        onGenerated: (generation) => {
                          updateMergeOutcome({ type: "generated", outcome: generation.outcome });
                          setConflationRoutingDiagnostics(generation.routing);
                          Log.addMessage(
                            `Verified imported-data changes: ${changeStatsSummary(generation.stats)}`,
                          );
                        },
                        onStageChange: (currentStepId) => {
                          setAutomaticMergeProgress((current) =>
                            current ? { ...current, currentStepId } : current,
                          );
                        },
                        patchOsmId,
                        worker: remote,
                      });

                      if (result.status === "cancelled") {
                        await remote.clearConflation(baseOsmId);
                        task.end("Merge cancelled by user");
                        goToStep("select-osm-pbf-files");
                        return;
                      }

                      mergePipelineCompleted = true;
                      setAutomaticMergeProgress((current) =>
                        current ? { ...current, currentStepId: "refresh-result" } : current,
                      );
                      await refreshMergedResult(result.generation.stats.osmId, mergedName, true);
                      setChangesetStats(null);
                      task.end(
                        `Automatic merge completed; intersections: ${changeStatsSummary(result.intersections)}`,
                      );
                      showVerifiedMergeResult();
                      return;
                    }
                    setAutomaticMergeProgress((current) =>
                      current ? { ...current, currentStepId: "merge-exact" } : current,
                    );
                    const merged = await remote.merge(
                      baseOsmId,
                      patchOsmId,
                      completeMergeOptions(),
                    );

                    mergePipelineCompleted = true;
                    completedOsmId = merged.id;
                    // The atomic worker stage already committed. Finish refreshing its result even
                    // when cancellation arrived too late; the original inputs are no longer live.
                    if (abortController.signal.aborted) {
                      Log.addMessage(
                        "Cancellation arrived after the merge was applied. Refreshing the completed result; start a new merge to use the original inputs again.",
                      );
                    }

                    // Use setMergedOsm to properly update file info for the new merged result
                    setAutomaticMergeProgress((current) =>
                      current ? { ...current, currentStepId: "refresh-result" } : current,
                    );
                    updateMergeOutcome({ type: "applied" });
                    await refreshMergedResult(merged.id, mergedName, true);
                    task.end("Automatic merge completed");
                    showVerifiedMergeResult();
                  } catch (error) {
                    const committedMergeId = committedMutationOsmId(error, "merge");
                    const committedApplyId = committedMutationOsmId(
                      error,
                      "applyChangesAndReplace",
                    );
                    if (mergePipelineCompleted || committedMergeId) {
                      if (committedMergeId) updateMergeOutcome({ type: "applied" });
                      // The worker finished every mutation; only refreshing React state failed.
                      try {
                        await refreshMergedResult(
                          mergedOsmRefreshRetryId(
                            error,
                            committedMergeId ?? committedApplyId ?? completedOsmId,
                          ),
                          mergedName,
                          true,
                          Boolean(committedMergeId || committedApplyId),
                        );
                        setChangesetStats(null);
                        task.end("Automatic merge completed after refreshing the merged dataset");
                        showVerifiedMergeResult();
                      } catch (refreshError) {
                        task.end(
                          `All merge stages completed, but the merged dataset could not be refreshed: ${refreshError instanceof Error ? refreshError.message : "Unknown error"}`,
                          "error",
                        );
                      }
                    } else if (conflationBaseApplied) {
                      // Preserve both datasets so the user can retry intersection creation without
                      // rediscovering or reapplying imported-data matches.
                      try {
                        await refreshMergedResult(
                          baseOsmId,
                          mergedName,
                          false,
                          Boolean(committedApplyId),
                        );
                      } catch (refreshError) {
                        Log.addMessage(
                          `Could not refresh the partially merged base: ${refreshError instanceof Error ? refreshError.message : "Unknown error"}`,
                        );
                      }
                      task.end(
                        `Imported-data changes were applied, but the remaining stages could not finish: ${error instanceof Error ? error.message : "Unknown error"}. The patch remains loaded; refresh the dataset if needed, then continue with intersections.`,
                        "error",
                      );
                      goToStep("create-intersections");
                    } else if (abortController.signal.aborted) {
                      task.end("Merge cancelled by user");
                      goToStep("select-osm-pbf-files");
                    } else {
                      task.end(
                        `Merge failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                        "error",
                      );
                      if (conflationOptions) {
                        const issue = matchingReviewIssue(error);
                        setMatchingIssue(issue);
                        // Discovery is read-only, so returning to candidate review is safe even when
                        // generation failed partway through validation.
                        const restoreFailure = await recoverConflationRunAllFailure({
                          restoreReview: conflationDiscoveryCompleted
                            ? async () => {
                                if (issue.source) {
                                  await remote.setConflationFilter(baseOsmId, issue.source);
                                  setConflationCandidateFilter(issue.source);
                                }
                                const [summary, page] = await Promise.all([
                                  remote.getConflationSummary(baseOsmId),
                                  remote.getConflationPage(baseOsmId, 0, CONFLATION_PAGE_SIZE, {
                                    groupBySource: true,
                                  }),
                                ]);
                                setConflationSummary(summary);
                                setConflationCandidatePageIndex(0);
                                setConflationCandidatePage(page);
                              }
                            : undefined,
                          showReview: () => goToStep("match-imported-data"),
                        });
                        if (restoreFailure) {
                          Log.addMessage(
                            `Could not restore candidate details after the failed merge: ${restoreFailure.error instanceof Error ? restoreFailure.error.message : "Unknown error"}`,
                          );
                        }
                      }
                    }
                  } finally {
                    setMergeAbortController(null);
                  }
                }}
              />
            }
          >
            <ItemMedia>
              <FastForwardIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Run automatic merge</ItemTitle>
              <ItemDescription>
                {requiresRemovalReview ? (
                  <span id="removal-manual-review-required">
                    Use Review each merge stage to select imported-way removals and inspect their
                    preview before applying.
                  </span>
                ) : (
                  "Skip diagnostics and review screens; apply direct merge, exact reconciliation, safe intersections, and only high-confidence fuzzy matches when enabled."
                )}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRightIcon />
            </ItemActions>
          </Item>
        </div>
      </Step>

      <Step step="run-all-steps" title="Merge in progress" guideId="run-all">
        <p>The active step may take a few minutes. Detailed worker messages remain in the log.</p>
        {automaticMergeProgress ? <LiveAutomaticMergeProgress {...automaticMergeProgress} /> : null}
        {mergeAbortController && (
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => {
              mergeAbortController.abort();
              setMergeAbortController(null);
            }}
          >
            <StopCircleIcon className="mr-2 h-4 w-4" />
            Request cancellation
          </Button>
        )}
      </Step>

      <Step step="inspect-base-osm" title="Inspect base OSM" guideId="inspect-base">
        <Card>
          <CardHeader>Base OSM PBF</CardHeader>
          <CardContent className="p-0">
            <OsmInfoTable
              defaultOpen={false}
              osm={base.osm}
              file={base.file}
              fileInfo={base.fileInfo}
            />
          </CardContent>
        </Card>
        <StepActions aria-label="Base diagnostic actions">
          <ActionButton
            icon={<SkipForwardIcon />}
            onAction={async () => {
              setChangesetStats(null);
              Log.addMessage("Skipped base duplicate diagnostic");
              goToStep("inspect-patch-osm");
            }}
            variant="outline"
          >
            Skip base diagnostic
          </ActionButton>
          <ActionButton
            disabled={!base.osm}
            icon={<SearchCodeIcon />}
            onAction={() =>
              startStepTask("Inspecting base OSM for duplicate entities", async () => {
                if (!base.osm) throw Error("Base OSM is not loaded");
                const changes = await remote.generateChangeset(
                  base.osm.id,
                  base.osm.id,
                  WITHIN_DATASET_DIAGNOSTIC_OPTIONS,
                );
                setChangesetReviewContext({ kind: "base-diagnostic" });
                setChangesetStats(changes);
                return changeStatsSummary(changes);
              })
            }
          >
            Scan base for duplicate candidates
          </ActionButton>
        </StepActions>
      </Step>

      <Step step="inspect-patch-osm" title="Inspect patch OSM" guideId="inspect-patch">
        <Card>
          <CardHeader>Patch OSM PBF</CardHeader>
          <CardContent className="p-0">
            <OsmInfoTable
              defaultOpen={false}
              osm={patch.osm}
              file={patch.file}
              fileInfo={patch.fileInfo}
            />
          </CardContent>
        </Card>
        <StepActions aria-label="Patch diagnostic actions">
          <ActionButton
            icon={<SkipForwardIcon />}
            onAction={async () => {
              setChangesetStats(null);
              Log.addMessage("Skipped patch duplicate diagnostic");
              goToStep("direct-merge");
            }}
            variant="outline"
          >
            Skip patch diagnostic
          </ActionButton>
          <ActionButton
            disabled={!patch.osm}
            icon={<SearchCodeIcon />}
            onAction={() =>
              startStepTask("Inspecting patch OSM for duplicate entities", async () => {
                if (!patch.osm) throw Error("Patch OSM is not loaded");
                const patchChanges = await remote.generateChangeset(
                  patch.osm.id,
                  patch.osm.id,
                  WITHIN_DATASET_DIAGNOSTIC_OPTIONS,
                );
                setChangesetReviewContext({ kind: "patch-diagnostic" });
                setChangesetStats(patchChanges);
                return changeStatsSummary(patchChanges);
              })
            }
          >
            Scan patch for duplicate candidates
          </ActionButton>
        </StepActions>
      </Step>

      <Step step="direct-merge" title="Direct merge" guideId="direct">
        <Card>
          <CardHeader>
            <CardTitle>Base OSM PBF</CardTitle>
            {base.osm && (
              <CardAction>
                <ActionButton icon={<DownloadIcon />} onAction={base.downloadOsm} variant="ghost" />
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <OsmInfoTable
              defaultOpen={false}
              osm={base.osm}
              file={base.file}
              fileInfo={base.fileInfo}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Patch OSM PBF</CardTitle>
            {patch.osm && (
              <CardAction>
                <ActionButton
                  icon={<DownloadIcon />}
                  onAction={patch.downloadOsm}
                  variant="ghost"
                />
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <OsmInfoTable
              defaultOpen={false}
              osm={patch.osm}
              file={patch.file}
              fileInfo={patch.fileInfo}
            />
          </CardContent>
        </Card>

        <StepActions aria-label="Direct merge actions">
          <ActionButton icon={<ArrowLeft />} onAction={async () => prevStep()} variant="outline">
            Back
          </ActionButton>
          <ActionButton
            icon={<FileDiff />}
            onAction={() =>
              startStepTask("Generating direct-merge preview", async () => {
                if (!base.osm || !patch.osm) throw Error("Missing data to generate changes");
                const results = await remote.generateChangeset(
                  base.osm.id,
                  patch.osm.id,
                  verifiedBaseMergeOptions(false),
                );
                setChangesetReviewContext({ kind: "direct-preview" });
                setConflationRoutingDiagnostics(null);
                setChangesetStats(results);
                return changeStatsSummary(results);
              })
            }
          >
            Preview direct merge
          </ActionButton>
        </StepActions>
      </Step>

      <Step
        step="review-changeset"
        title={reviewStepTitle(changesetReviewContext)}
        guideId={reviewGuideId(changesetReviewContext)}
      >
        <ActionButton
          icon={<DownloadIcon />}
          disabled={changesetStats === null || pendingMergedRefresh !== null}
          onAction={downloadJsonChanges}
        >
          Download JSON changes
        </ActionButton>
        {changesDownloadError ? <p role="alert">{changesDownloadError}</p> : null}
        {changesetStats && base.osm && (
          <Card>
            <CardHeader>{reviewChangesetTitle(changesetReviewContext)}</CardHeader>
            <CardContent className="p-0">
              <ChangesSummary />
              <Suspense fallback={<LoadingState />}>
                <Details>
                  <DetailsSummary>All changes</DetailsSummary>
                  <DetailsContent>
                    <ChangesFilters />
                    <ChangesExpandableList />
                    <ChangesPagination />
                  </DetailsContent>
                </Details>
              </Suspense>
            </CardContent>
          </Card>
        )}
        {conflationRoutingDiagnostics ? (
          <ConflationRoutingDiagnostics diagnostics={conflationRoutingDiagnostics} />
        ) : null}

        {changesetReviewContext.kind === "cumulative" &&
        changesetReviewContext.matching &&
        changesetStats !== null &&
        generatedOutcome &&
        requiresRemovalReview ? (
          <ConflationWayRemovalPreview outcome={generatedOutcome} />
        ) : null}

        {changesetReviewContext.kind === "cumulative" && changesetReviewContext.matching ? (
          <MatchingReviewProblem issue={matchingIssue} />
        ) : null}

        <StepActions aria-label="Changeset review actions">
          {changesetReviewContext.kind === "cumulative" &&
          changesetReviewContext.matching &&
          changesetStats !== null &&
          base.osm &&
          patch.osm ? (
            <BackToMatching onBack={returnToMatching} />
          ) : null}
          {isDiagnosticReview ? (
            <ActionButton
              onAction={async () => {
                setChangesetStats(null);
                nextStep();
              }}
              icon={<ArrowRightIcon />}
            >
              Continue without applying
            </ActionButton>
          ) : isDirectPreviewReview ? (
            <ActionButton
              onAction={async () => {
                setChangesetStats(null);
                nextStep();
              }}
              icon={<ArrowRightIcon />}
            >
              Continue to matching and reconciliation
            </ActionButton>
          ) : changesetStats == null || hasZeroChanges ? (
            <ActionButton
              disabled={pendingMergedRefresh !== null}
              onAction={async () => {
                if (changesetReviewContext.kind === "cumulative" && changesetStats !== null) {
                  updateMergeOutcome({ type: "applied" });
                  updateMergeOutcome({ type: "refreshed" });
                }
                if (completesVerifiedMerge) showVerifiedMergeResult();
                else nextStep();
              }}
              icon={<ArrowRightIcon />}
            >
              {changesetReviewContext.kind === "intersections"
                ? "No intersections, finish merge"
                : "No changes, go to next step"}
            </ActionButton>
          ) : (
            <ActionButton
              icon={<MergeIcon />}
              onAction={() =>
                startStepTask("Applying changes to OSM", async () => {
                  if (!changesetStats) throw Error("Changes are not loaded");
                  const applied = await applyChanges();
                  if (changesetStats.osmId === base.osm?.id) {
                    const mergedName = makeMergedDownloadName(
                      runInputs?.baseName ?? base.fileInfo?.fileName,
                      runInputs?.patchName ?? patch.fileInfo?.fileName,
                    );
                    await refreshMergedResult(
                      applied.osmId,
                      mergedName,
                      completesVerifiedMerge,
                      applied.synchronize,
                    );
                  } else if (changesetStats.osmId === patch.osm?.id) {
                    if (applied.synchronize) await remote.synchronizeDataset(applied.osmId);
                    await patch.setMergedOsm(applied.osmId);
                  } else {
                    throw Error("Changeset OSM ID does not match base or patch OSM ID");
                  }
                  if (completesVerifiedMerge) {
                    updateMergeOutcome({ type: "complete" });
                    patch.setOsm(null);
                  }
                  return "Changes applied";
                })
              }
            >
              {changesetReviewContext.kind === "intersections"
                ? "Apply intersections and finish"
                : "Apply cumulative merge"}
            </ActionButton>
          )}
        </StepActions>
      </Step>

      <Step step="match-imported-data" title="Match imported data" guideId="match-imported">
        <MatchingReviewProblem issue={matchingIssue} />
        <ActionButton
          disabled={!base.osm || !patch.osm || !conflationOptions || isConflationFilterPending}
          icon={<SearchCodeIcon />}
          onAction={async () => {
            if (!base.osm || !patch.osm || !conflationOptions) {
              throw Error("Valid proximity-matching options and both inputs are required");
            }
            const task = Log.startTask("Discovering imported-data match candidates");
            try {
              resetConflationReview();
              setMatchingIssue(null);
              const summary = await remote.discoverConflation(
                base.osm.id,
                patch.osm.id,
                conflationOptions,
              );
              invalidateMatchingPreview();
              setConflationSummary(summary);
              const page = await remote.getConflationPage(base.osm.id, 0, CONFLATION_PAGE_SIZE, {
                groupBySource: true,
              });
              setConflationCandidatePage(page);
              task.end(`Found ${summary.total.toLocaleString()} imported-data match candidates`);
            } catch (error) {
              task.end(
                `Candidate discovery failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                "error",
              );
              throw error;
            }
          }}
        >
          {conflationSummary ? "Run candidate discovery again" : "Discover match candidates"}
        </ActionButton>

        {conflationSummary && conflationCandidatePage && base.osm && patch.osm ? (
          <ConflationReview
            base={base.osm}
            patch={patch.osm}
            summary={conflationSummary}
            page={conflationCandidatePage}
            filter={conflationCandidateFilter}
            isFilterPending={isConflationFilterPending}
            allowWayRemoval={requiresRemovalReview}
            onDecision={updateConflationDecision}
            onResetDecision={resetConflationDecision}
            onLeaveUnmatched={(source) => saveConflationSourceChoice(source, null)}
            onBulkDecision={updateConflationBulkDecision}
            onFilterChange={updateConflationFilter}
            onPageChange={loadConflationPage}
          />
        ) : null}

        <StepActions aria-label="Imported-data matching actions">
          <ActionButton
            disabled={isConflationFilterPending}
            icon={<ArrowLeft />}
            onAction={async () => prevStep()}
            variant="outline"
          >
            Back
          </ActionButton>
          <ActionButton
            disabled={!conflationSummary || isConflationFilterPending}
            icon={<ArrowRightIcon />}
            onAction={async () => nextStep()}
          >
            Continue with current decisions
          </ActionButton>
        </StepActions>
      </Step>

      <Step step="deduplicate-nodes" title="Reconcile matching entities" guideId="reconcile">
        <MatchingReviewProblem issue={matchingIssue} />
        <Card>
          <CardHeader>
            <CardTitle>Current OSM PBF</CardTitle>
            {base.osm && (
              <CardAction>
                <ActionButton icon={<DownloadIcon />} onAction={base.downloadOsm} variant="ghost" />
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <OsmInfoTable
              defaultOpen={false}
              osm={base.osm}
              file={base.file}
              fileInfo={base.fileInfo}
            />
          </CardContent>
        </Card>

        <StepActions aria-label="Exact reconciliation actions">
          {conflationOptions && conflationSummary ? (
            <BackToMatching onBack={returnToMatching} />
          ) : null}
          <ActionButton
            icon={<SkipForwardIcon />}
            onAction={() =>
              startStepTask(
                "Generating cumulative preview without exact reconciliation",
                async () => {
                  return generateVerifiedChangeset(false);
                },
              )
            }
            variant="outline"
          >
            Preview without exact reconciliation
          </ActionButton>
          <ActionButton
            icon={<FileDiff />}
            onAction={() =>
              startStepTask("Generating cumulative preview with exact reconciliation", async () => {
                return generateVerifiedChangeset(true);
              })
            }
          >
            Preview with exact reconciliation
          </ActionButton>
        </StepActions>
      </Step>

      <Step step="create-intersections" title="Create intersections" guideId="intersections">
        <StepActions aria-label="Intersection actions">
          <ActionButton
            disabled={pendingMergedRefresh !== null}
            icon={<SkipForwardIcon />}
            onAction={async () => showVerifiedMergeResult()}
            variant="outline"
          >
            Skip intersections and finish
          </ActionButton>
          <ActionButton
            disabled={pendingMergedRefresh !== null}
            icon={<FileDiff />}
            onAction={() =>
              startStepTask("Generating intersection preview", async () => {
                if (!base.osm || !patch.osm) throw Error("Missing data to generate changes");
                const results = await remote.generateChangeset(
                  base.osm.id,
                  patch.osm.id,
                  INTERSECTION_OPTIONS,
                );
                setChangesetReviewContext({ kind: "intersections" });
                setConflationRoutingDiagnostics(null);
                setChangesetStats(results);
                return changeStatsSummary(results);
              })
            }
          >
            Preview intersection changes
          </ActionButton>
        </StepActions>
      </Step>

      <Step step="inspect-final-osm" title="Inspect final merged OSM" guideId="final">
        {completion ? (
          <MergeCompletionSummary
            completion={completion}
            onDownloadReport={downloadOutcomeReport}
          />
        ) : null}
        {base.osm && (
          <>
            <Card>
              <CardHeader>Merged OSM — in-memory result</CardHeader>
              <CardContent className="p-0">
                <OsmInfoTable
                  defaultOpen={false}
                  osm={base.osm}
                  file={base.file}
                  fileInfo={base.fileInfo}
                />
              </CardContent>
            </Card>

            {conflationRoutingDiagnostics ? (
              <ConflationRoutingDiagnostics diagnostics={conflationRoutingDiagnostics} />
            ) : null}

            {selectedEntity && (
              <Card>
                <CardHeader>
                  <CardTitle>Selected entity</CardTitle>
                  <CardAction>
                    <Button
                      onClick={() => {
                        if (!base.osm || !selectedEntity) return;
                        flyToEntity(base.osm, selectedEntity);
                      }}
                      variant="ghost"
                      size="icon-sm"
                      title="Fit bounds to entity"
                    >
                      <MaximizeIcon />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="p-0">
                  <EntityDetails entity={selectedEntity} defaultOpen={true} osm={base.osm} />
                </CardContent>
              </Card>
            )}

            <StepActions aria-label="Final merged OSM actions">
              {!base.isStored && base.canStore && (
                <ActionButton icon={<SaveIcon />} onAction={base.saveToStorage} variant="outline">
                  Save to storage
                </ActionButton>
              )}
              <ActionButton icon={<DownloadIcon />} onAction={() => base.downloadOsm()}>
                Download merged OSM PBF
              </ActionButton>
              <ActionButton icon={<ArrowLeft />} variant="outline" onAction={startNewMerge}>
                Start a new merge
              </ActionButton>
            </StepActions>
          </>
        )}
      </Step>
    </div>
  );
}

function Step({
  step,
  title,
  guideId,
  isTransitioning,
  children,
}: {
  step: (typeof STEPS)[number];
  title: string;
  guideId: MergeStepGuideId;
  isTransitioning?: boolean;
  children: React.ReactNode;
}) {
  const currentStep = useAtomValue(stepAtom);
  const stepIndex = useAtomValue(stepIndexAtom);
  const conflationEnabled = useAtomValue(conflationFormAtom).enabled;
  const hiddenConflationStepBeforeCurrent =
    !conflationEnabled && STEPS.slice(0, stepIndex + 1).includes("match-imported-data") ? 1 : 0;
  if (step !== currentStep) return null;
  if (isTransitioning === true) return <LoadingState>Please wait...</LoadingState>;
  return (
    <>
      <Card>
        <CardHeader>
          {step === "run-all-steps"
            ? `Automatic workflow: ${title}`
            : `${stepIndex + 1 - hiddenConflationStepBeforeCurrent}: ${title}`}
        </CardHeader>
        <CardContent className="p-0">
          <MergeStepGuide guideId={guideId} />
        </CardContent>
      </Card>
      {children}
    </>
  );
}
