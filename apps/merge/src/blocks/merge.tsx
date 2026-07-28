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
  XIcon,
} from "lucide-react";
import {
  changeStatsSummary,
  type OsmConflationBulkDecisionRequest,
  type OsmConflationDecision,
} from "osmix";
import { Suspense, useMemo, useState } from "react";

import ActionButton from "../components/action-button";
import {
  type AutomaticMergeProgressState,
  CONFLATION_AUTOMATIC_MERGE_STEPS,
  EXACT_AUTOMATIC_MERGE_STEPS,
  LiveAutomaticMergeProgress,
} from "../components/automatic-merge-progress";
import { ConflationConfig } from "../components/conflation-config";
import { ConflationReview } from "../components/conflation-review";
import { ConflationRoutingDiagnostics } from "../components/conflation-routing-diagnostics";
import { Details, DetailsContent, DetailsSummary } from "../components/details";
import EntityDetails from "../components/entity-details";
import { FullIndexRequired, hasFullNodeIndex } from "../components/full-index-required";
import { MergeStepGuide, type MergeStepGuideId } from "../components/merge-step-guide";
import ChangesSummary, {
  ChangesExpandableList,
  ChangesFilters,
  ChangesPagination,
} from "../components/osm-changes-summary";
import OsmInfoTable from "../components/osm-info-table";
import { LoadingState } from "../components/section";
import StoredOsmList from "../components/stored-osm-list";
import { Button } from "../components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "../components/ui/button-group";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../components/ui/item";
import { useFlyToEntity, useFlyToOsmBounds } from "../hooks/map";
import { useOsmFile } from "../hooks/osm";
import { toOsmConflationOptions, validateConflationForm } from "../lib/conflation-workflow";
import {
  completeMergeOptions,
  finalizeVerifiedMerge,
  INTERSECTION_OPTIONS,
  recoverConflationRunAllFailure,
  runConflationAllSteps,
  verifiedBaseMergeOptions,
  WITHIN_DATASET_DIAGNOSTIC_OPTIONS,
} from "../lib/merge-workflow";
import { showSaveFilePickerWithFallback } from "../lib/save-file-picker";
import { cn } from "../lib/utils";
import { BASE_OSM_KEY, PATCH_OSM_KEY } from "../settings";
import { changesetStatsAtom } from "../state/changes";
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
import { Log } from "../state/log";
import { selectedEntityAtom, selectOsmEntityAtom } from "../state/osm";
import { mergeAbortControllerAtom, osmLoadingAbortControllerAtom } from "../state/status";
import { osmWorker } from "../state/worker";

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

const stepIndexAtom = atom<number>(0);

type ChangesetReviewContext =
  | { kind: "base-diagnostic" }
  | { kind: "patch-diagnostic" }
  | { kind: "direct-preview" }
  | { kind: "cumulative"; exactReconciliation: boolean }
  | { kind: "intersections" };

const changesetReviewContextAtom = atom<ChangesetReviewContext>({
  kind: "cumulative",
  exactReconciliation: true,
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
  const base = useOsmFile(BASE_OSM_KEY);
  const patch = useOsmFile(PATCH_OSM_KEY);
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
  const [automaticMergeProgress, setAutomaticMergeProgress] =
    useState<AutomaticMergeProgressState | null>(null);
  const setConflationDecisions = useSetAtom(conflationDecisionsAtom);
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
  const showVerifiedMergeResult = () =>
    finalizeVerifiedMerge(
      () => patch.setOsm(null),
      () => goToStep("inspect-final-osm"),
    );
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
  const conflationOptions = conflationValidationMessage
    ? undefined
    : toOsmConflationOptions(conflationForm);

  const loadConflationPage = async (page: number) => {
    if (!base.osm) throw Error("Base OSM is not loaded");
    const result = await osmWorker.getConflationPage(base.osm.id, page, CONFLATION_PAGE_SIZE);
    setConflationCandidatePageIndex(page);
    setConflationCandidatePage(result);
  };

  const updateConflationFilter = async (filter: typeof conflationCandidateFilter) => {
    if (!base.osm) throw Error("Base OSM is not loaded");
    const previousFilter = conflationCandidateFilter;
    setConflationCandidateFilter(filter);
    setIsConflationFilterPending(true);
    try {
      await osmWorker.setConflationFilter(base.osm.id, filter);
      await loadConflationPage(0);
    } catch (error) {
      // Keep the visible controls aligned with the still-displayed page when a
      // worker failure prevents the requested filter from being applied.
      try {
        await osmWorker.setConflationFilter(base.osm.id, previousFilter);
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

  const updateConflationDecision = async (decision: OsmConflationDecision) => {
    if (!base.osm) throw Error("Base OSM is not loaded");
    const summary = await osmWorker.setConflationDecision(base.osm.id, decision);
    setConflationDecisions((current) => [
      ...current.filter((existing) => existing.candidateId !== decision.candidateId),
      decision,
    ]);
    setConflationSummary(summary);
    await loadConflationPage(conflationCandidatePageIndex);
  };

  const updateConflationBulkDecision = async (request: OsmConflationBulkDecisionRequest) => {
    if (!base.osm) throw Error("Base OSM is not loaded");
    const result = await osmWorker.applyConflationBulkDecision(base.osm.id, request);
    setConflationDecisions(result.decisions);
    setConflationSummary(result.summary);
    await loadConflationPage(0);
    Log.addMessage(
      `Updated ${result.preview.changedCandidates.toLocaleString()} filtered conflation decisions`,
    );
  };

  const generateVerifiedChangeset = async (reconcile: boolean) => {
    if (!base.osm || !patch.osm) throw Error("Missing data to generate changes");
    setChangesetReviewContext({ kind: "cumulative", exactReconciliation: reconcile });
    if (conflationOptions) {
      if (!conflationSummary) {
        throw Error("Discover and review imported-data match candidates first");
      }
      const result = await osmWorker.generateConflationChangeset(
        base.osm.id,
        verifiedBaseMergeOptions(reconcile),
      );
      setChangesetStats(result.stats);
      setConflationRoutingDiagnostics(result.routing);
      return changeStatsSummary(result.stats);
    }

    setConflationRoutingDiagnostics(null);
    const result = await osmWorker.generateChangeset(
      base.osm.id,
      patch.osm.id,
      verifiedBaseMergeOptions(reconcile),
    );
    setChangesetStats(result);
    return changeStatsSummary(result);
  };

  const downloadJsonChanges = async () => {
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

    const PAGE_SIZE = 100_000;
    const task = Log.startTask(`Converting ${changesetStats.totalChanges} changes to JSON`);
    let page = 0;
    let changesetPage: Awaited<ReturnType<typeof osmWorker.getChangesetPage>>;
    do {
      changesetPage = await osmWorker.getChangesetPage(changesetStats.osmId, page++, PAGE_SIZE);
      const json = JSON.stringify(changesetPage.changes, null, 2);
      await stream.write(json);
    } while (changesetPage.changes && changesetPage.changes.length > 0);
    void stream.close();
    task.end("Changeset converted to JSON");
  };

  const applyChanges = async () => {
    if (!changesetStats) throw Error("Changeset stats are not loaded");
    await osmWorker.applyChangesAndReplace(changesetStats.osmId);
    setChangesetStats(null);
    return changesetStats.osmId;
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
          <CardHeader>
            <CardTitle>Base OSM — authoritative existing dataset</CardTitle>
            {base.osm ? (
              <CardAction>
                <ActionButton
                  icon={<DownloadIcon />}
                  title="Download base OSM"
                  onAction={base.downloadOsm}
                  variant="ghost"
                />
              </CardAction>
            ) : null}
          </CardHeader>
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
          <CardHeader>
            <CardTitle>Patch OSM — imported additions and updates</CardTitle>
            {patch.osm && (
              <CardAction>
                <ButtonGroup>
                  {!patch.isStored && patch.canStore && (
                    <ActionButton
                      icon={<SaveIcon />}
                      title="Save to storage"
                      variant="ghost"
                      onAction={patch.saveToStorage}
                    />
                  )}
                  <ActionButton
                    icon={<XIcon />}
                    title="Clear patch OSM file"
                    variant="ghost"
                    onAction={async () => {
                      await patch.loadOsmFile(null);
                    }}
                  />
                </ButtonGroup>
              </CardAction>
            )}
          </CardHeader>
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
            !base.osm || !patch.osm || conflationValidationMessage
              ? "opacity-50 pointer-events-none"
              : "",
          )}
        >
          <Item
            render={
              <button
                type="button"
                disabled={!base.osm || !patch.osm || Boolean(conflationValidationMessage)}
                onClick={() => {
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
                disabled={!base.osm || !patch.osm || Boolean(conflationValidationMessage)}
                onClick={async () => {
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
                  let conflationPipelineCompleted = false;

                  try {
                    setChangesetStats(null);
                    resetConflationReview();
                    if (conflationOptions) {
                      const result = await runConflationAllSteps({
                        baseOsmId,
                        conflation: conflationOptions,
                        isCancelled: () => abortController.signal.aborted,
                        onBaseApplied: () => {
                          conflationBaseApplied = true;
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
                        worker: osmWorker,
                      });

                      if (result.status === "cancelled") {
                        await osmWorker.clearConflation(baseOsmId);
                        task.end("Merge cancelled by user");
                        goToStep("select-osm-pbf-files");
                        return;
                      }

                      conflationPipelineCompleted = true;
                      setAutomaticMergeProgress((current) =>
                        current ? { ...current, currentStepId: "refresh-result" } : current,
                      );
                      await base.setMergedOsm(result.generation.stats.osmId, mergedName);
                      setChangesetStats(null);
                      task.end(
                        `Automatic merge completed; intersections: ${changeStatsSummary(result.intersections)}`,
                      );
                      finalizeVerifiedMerge(
                        () => patch.setOsm(null),
                        () => goToStep("inspect-final-osm"),
                      );
                      return;
                    }
                    setAutomaticMergeProgress((current) =>
                      current ? { ...current, currentStepId: "merge-exact" } : current,
                    );
                    const merged = await osmWorker.merge(
                      baseOsmId,
                      patchOsmId,
                      completeMergeOptions(),
                    );

                    // The worker merge is atomic and cannot stop mid-stage. If cancellation arrived
                    // while it ran, do not present the completed result as an ordinary success.
                    if (abortController.signal.aborted) {
                      task.end(
                        "Cancellation was requested after the worker stage completed; reload the original inputs to restart",
                      );
                      goToStep("select-osm-pbf-files");
                      return;
                    }

                    // Use setMergedOsm to properly update file info for the new merged result
                    setAutomaticMergeProgress((current) =>
                      current ? { ...current, currentStepId: "refresh-result" } : current,
                    );
                    await base.setMergedOsm(merged.id, mergedName);
                    patch.setOsm(null);

                    task.end("Automatic merge completed");
                    goToStep("inspect-final-osm");
                  } catch (error) {
                    if (conflationPipelineCompleted) {
                      // The worker finished every mutation; only refreshing React state failed.
                      try {
                        await base.setMergedOsm(baseOsmId, mergedName);
                        setChangesetStats(null);
                        task.end("Automatic merge completed after refreshing the merged dataset");
                        finalizeVerifiedMerge(
                          () => patch.setOsm(null),
                          () => goToStep("inspect-final-osm"),
                        );
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
                        await base.setMergedOsm(baseOsmId, mergedName);
                      } catch (refreshError) {
                        Log.addMessage(
                          `Could not refresh the partially merged base: ${refreshError instanceof Error ? refreshError.message : "Unknown error"}`,
                        );
                      }
                      task.end(
                        `Imported-data changes were applied, but intersection creation failed: ${error instanceof Error ? error.message : "Unknown error"}. The patch remains loaded so the intersection step can be retried.`,
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
                        // Discovery is read-only, so returning to candidate review is safe even when
                        // generation failed partway through validation.
                        const restoreFailure = await recoverConflationRunAllFailure({
                          restoreReview: conflationDiscoveryCompleted
                            ? async () => {
                                const [summary, page] = await Promise.all([
                                  osmWorker.getConflationSummary(baseOsmId),
                                  osmWorker.getConflationPage(baseOsmId, 0, CONFLATION_PAGE_SIZE),
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
                Skip diagnostics and review screens; apply direct merge, exact reconciliation, safe
                intersections, and only high-confidence fuzzy matches when enabled.
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
        <ActionButton
          disabled={!base.osm}
          icon={<SearchCodeIcon />}
          onAction={() =>
            startStepTask("Inspecting base OSM for duplicate entities", async () => {
              if (!base.osm) throw Error("Base OSM is not loaded");
              setChangesetReviewContext({ kind: "base-diagnostic" });
              const changes = await osmWorker.generateChangeset(
                base.osm.id,
                base.osm.id,
                WITHIN_DATASET_DIAGNOSTIC_OPTIONS,
              );
              setChangesetStats(changes);
              return changeStatsSummary(changes);
            })
          }
        >
          Scan base for duplicate candidates
        </ActionButton>
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
        <ActionButton
          disabled={!patch.osm}
          icon={<SearchCodeIcon />}
          onAction={() =>
            startStepTask("Inspecting patch OSM for duplicate entities", async () => {
              if (!patch.osm) throw Error("Patch OSM is not loaded");
              setChangesetReviewContext({ kind: "patch-diagnostic" });
              const patchChanges = await osmWorker.generateChangeset(
                patch.osm.id,
                patch.osm.id,
                WITHIN_DATASET_DIAGNOSTIC_OPTIONS,
              );
              setChangesetStats(patchChanges);
              return changeStatsSummary(patchChanges);
            })
          }
        >
          Scan patch for duplicate candidates
        </ActionButton>
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

        <ButtonGroup className="w-full">
          <ActionButton className="flex-1" onAction={async () => prevStep()} icon={<ArrowLeft />}>
            Back
          </ActionButton>
          <ButtonGroupSeparator />
          <ActionButton
            className="flex-1"
            icon={<FileDiff />}
            onAction={() =>
              startStepTask("Generating direct-merge preview", async () => {
                if (!base.osm || !patch.osm) throw Error("Missing data to generate changes");
                setChangesetReviewContext({ kind: "direct-preview" });
                setConflationRoutingDiagnostics(null);
                const results = await osmWorker.generateChangeset(
                  base.osm.id,
                  patch.osm.id,
                  verifiedBaseMergeOptions(false),
                );
                setChangesetStats(results);
                return changeStatsSummary(results);
              })
            }
          >
            Preview direct merge
          </ActionButton>
        </ButtonGroup>
      </Step>

      <Step
        step="review-changeset"
        title={reviewStepTitle(changesetReviewContext)}
        guideId={reviewGuideId(changesetReviewContext)}
      >
        <ActionButton icon={<DownloadIcon />} onAction={downloadJsonChanges}>
          Download JSON changes
        </ActionButton>
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
            onAction={async () => {
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
                const changedOsmId = await applyChanges();
                if (changesetStats.osmId === base.osm?.id) {
                  const mergedName = makeMergedDownloadName(
                    base.fileInfo?.fileName,
                    patch.fileInfo?.fileName,
                  );
                  await base.setMergedOsm(changedOsmId, mergedName);
                } else if (changesetStats.osmId === patch.osm?.id) {
                  await patch.setMergedOsm(changedOsmId);
                } else {
                  throw Error("Changeset OSM ID does not match base or patch OSM ID");
                }
                if (completesVerifiedMerge) patch.setOsm(null);
                return "Changes applied";
              })
            }
          >
            {changesetReviewContext.kind === "intersections"
              ? "Apply intersections and finish"
              : "Apply cumulative merge"}
          </ActionButton>
        )}
      </Step>

      <Step step="match-imported-data" title="Match imported data" guideId="match-imported">
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
              const summary = await osmWorker.discoverConflation(
                base.osm.id,
                patch.osm.id,
                conflationOptions,
              );
              setConflationSummary(summary);
              const page = await osmWorker.getConflationPage(base.osm.id, 0, CONFLATION_PAGE_SIZE);
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
            onDecision={updateConflationDecision}
            onBulkDecision={updateConflationBulkDecision}
            onFilterChange={updateConflationFilter}
            onPageChange={loadConflationPage}
          />
        ) : null}

        <ButtonGroup className="w-full">
          <ActionButton
            className="flex-1"
            disabled={isConflationFilterPending}
            icon={<ArrowLeft />}
            onAction={async () => prevStep()}
          >
            Back
          </ActionButton>
          <ButtonGroupSeparator />
          <ActionButton
            className="flex-1"
            disabled={!conflationSummary || isConflationFilterPending}
            icon={<ArrowRightIcon />}
            onAction={async () => nextStep()}
          >
            Continue with current decisions
          </ActionButton>
        </ButtonGroup>
      </Step>

      <Step step="deduplicate-nodes" title="Reconcile matching entities" guideId="reconcile">
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

        <ButtonGroup className="w-full">
          <ActionButton
            className="flex-1"
            icon={<SkipForwardIcon />}
            onAction={() =>
              startStepTask(
                "Generating cumulative preview without exact reconciliation",
                async () => {
                  return generateVerifiedChangeset(false);
                },
              )
            }
          >
            Preview without exact reconciliation
          </ActionButton>
          <ButtonGroupSeparator />
          <ActionButton
            className="flex-1"
            icon={<FileDiff />}
            onAction={() =>
              startStepTask("Generating cumulative preview with exact reconciliation", async () => {
                return generateVerifiedChangeset(true);
              })
            }
          >
            Preview with exact reconciliation
          </ActionButton>
        </ButtonGroup>
      </Step>

      <Step step="create-intersections" title="Create intersections" guideId="intersections">
        <ButtonGroup className="w-full">
          <ActionButton
            className="flex-1"
            icon={<SkipForwardIcon />}
            onAction={async () => showVerifiedMergeResult()}
          >
            Skip intersections and finish
          </ActionButton>
          <ButtonGroupSeparator />
          <ActionButton
            className="flex-1"
            icon={<FileDiff />}
            onAction={() =>
              startStepTask("Generating intersection preview", async () => {
                if (!base.osm || !patch.osm) throw Error("Missing data to generate changes");
                setChangesetReviewContext({ kind: "intersections" });
                setConflationRoutingDiagnostics(null);
                const results = await osmWorker.generateChangeset(
                  base.osm.id,
                  patch.osm.id,
                  INTERSECTION_OPTIONS,
                );
                setChangesetStats(results);
                return changeStatsSummary(results);
              })
            }
          >
            Preview intersection changes
          </ActionButton>
        </ButtonGroup>
      </Step>

      <Step step="inspect-final-osm" title="Inspect final merged OSM" guideId="final">
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

            <div className="flex flex-col gap-2">
              <ActionButton icon={<DownloadIcon />} onAction={() => base.downloadOsm()}>
                Download merged OSM PBF
              </ActionButton>
              {!base.isStored && base.canStore && (
                <ActionButton icon={<SaveIcon />} onAction={base.saveToStorage}>
                  Save to storage
                </ActionButton>
              )}
            </div>
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
