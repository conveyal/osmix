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
import { changeStatsSummary } from "osmix";
import { Suspense, useMemo } from "react";

import ActionButton from "../components/action-button";
import { ConflationConfig } from "../components/conflation-config";
import { ConflationReview } from "../components/conflation-review";
import { ConflationRoutingDiagnostics } from "../components/conflation-routing-diagnostics";
import { Details, DetailsContent, DetailsSummary } from "../components/details";
import EntityDetails from "../components/entity-details";
import { FullIndexRequired, hasFullNodeIndex } from "../components/full-index-required";
import ChangesSummary, {
  ChangesExpandableList,
  ChangesFilters,
  ChangesPagination,
} from "../components/osm-changes-summary";
import OsmInfoTable from "../components/osm-info-table";
import { LoadingState } from "../components/section";
import StoredOsmList from "../components/stored-osm-list";
import TaskProgress from "../components/task-progress";
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
  type ChangesetReviewPurpose,
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
const changesetReviewPurposeAtom = atom<ChangesetReviewPurpose>("apply");
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

export default function MergeBlock() {
  const base = useOsmFile(BASE_OSM_KEY);
  const patch = useOsmFile(PATCH_OSM_KEY);
  const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom);
  const [changesetReviewPurpose, setChangesetReviewPurpose] = useAtom(changesetReviewPurposeAtom);
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
    await osmWorker.setConflationFilter(base.osm.id, filter);
    setConflationCandidateFilter(filter);
    await loadConflationPage(0);
  };

  const updateConflationDecision = async (decision: (typeof conflationDecisions)[number]) => {
    if (!base.osm) throw Error("Base OSM is not loaded");
    const summary = await osmWorker.setConflationDecision(base.osm.id, decision);
    setConflationDecisions((current) => [
      ...current.filter((existing) => existing.candidateId !== decision.candidateId),
      decision,
    ]);
    setConflationSummary(summary);
    await loadConflationPage(conflationCandidatePageIndex);
  };

  const updateConflationDecisions = async (decisions: typeof conflationDecisions) => {
    if (!base.osm) throw Error("Base OSM is not loaded");
    const changedIds = new Set(decisions.map((decision) => decision.candidateId));
    const next = [
      ...conflationDecisions.filter((decision) => !changedIds.has(decision.candidateId)),
      ...decisions,
    ];
    const summary = await osmWorker.setConflationDecisions(base.osm.id, next);
    setConflationDecisions(next);
    setConflationSummary(summary);
    await loadConflationPage(conflationCandidatePageIndex);
  };

  const generateVerifiedChangeset = async (reconcile: boolean) => {
    if (!base.osm || !patch.osm) throw Error("Missing data to generate changes");
    setChangesetReviewPurpose("apply");
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
      <Step step="select-osm-pbf-files" title="Select OSM files">
        <Card>
          <CardHeader>Merge steps</CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ol className="list-decimal list-inside">
              <li>Inspect each input for possible internal duplicates</li>
              <li>Merge patch OSM onto base OSM</li>
              <li>Reconcile compatible nodes and ways across the two inputs</li>
              <li>Create new intersections in merged data where ways cross</li>
            </ol>
            <p>
              Internal duplicate scans are diagnostic only. The merge preserves both original
              inputs, prioritizes same-ID patch entities, and only reconciles safe cross-dataset
              matches.
            </p>
          </CardContent>
        </Card>

        <ConflationConfig />

        <Card>
          <CardHeader>
            <CardTitle>Select patch OSM to merge</CardTitle>
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
              <ItemTitle>Option 1: Verify each step</ItemTitle>
              <ItemDescription>Review cumulative changes before applying them.</ItemDescription>
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
                  goToStep("run-all-steps");

                  const abortController = new AbortController();
                  setMergeAbortController(abortController);

                  const task = Log.startTask("Running all merge steps, please wait...");
                  if (!base.osm) throw Error("Base OSM is not loaded");
                  if (!patch.osm) throw Error("Patch OSM is not loaded");
                  const baseOsmId = base.osm.id;
                  const patchOsmId = patch.osm.id;
                  const mergedName = makeMergedDownloadName(
                    base.fileInfo?.fileName,
                    patch.fileInfo?.fileName,
                  );
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
                      await base.setMergedOsm(result.generation.stats.osmId, mergedName);
                      setChangesetStats(null);
                      task.end(
                        `All merge steps completed; intersections: ${changeStatsSummary(result.intersections)}`,
                      );
                      finalizeVerifiedMerge(
                        () => patch.setOsm(null),
                        () => goToStep("inspect-final-osm"),
                      );
                      return;
                    }
                    const merged = await osmWorker.merge(
                      baseOsmId,
                      patchOsmId,
                      completeMergeOptions(),
                    );

                    // Check if cancelled before applying results
                    if (abortController.signal.aborted) {
                      task.end("Merge cancelled by user");
                      goToStep("select-osm-pbf-files");
                      return;
                    }

                    // Use setMergedOsm to properly update file info for the new merged result
                    await base.setMergedOsm(merged.id, mergedName);
                    patch.setOsm(null);

                    task.end("All merge steps completed");
                    goToStep("inspect-final-osm");
                  } catch (error) {
                    if (conflationPipelineCompleted) {
                      try {
                        await base.setMergedOsm(baseOsmId, mergedName);
                        setChangesetStats(null);
                        task.end("All merge steps completed after refreshing the merged dataset");
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
              <ItemTitle>Option 2: Run all merge steps</ItemTitle>
              <ItemDescription>Run without stopping for verification.</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRightIcon />
            </ItemActions>
          </Item>
        </div>
      </Step>

      <Step step="run-all-steps" title="Running all merge steps">
        <p>Monitor the activity log below for progress. This may take a few minutes to complete.</p>
        <TaskProgress />
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
            Cancel Merge
          </Button>
        )}
      </Step>

      <Step step="inspect-base-osm" title="Inspect base OSM">
        <p>
          Scan the base file for possible duplicate entities inside this dataset. The results are
          diagnostic only and cannot be applied from this workflow.
        </p>
        <p>
          Nearby geometry alone is not enough to safely combine OSM entities because roads at
          different layers, restrictions, and other topology may intentionally be close together.
          Review any candidates in the next step; continuing leaves the base unchanged.
        </p>
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
              setChangesetReviewPurpose("diagnostic");
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

      <Step step="inspect-patch-osm" title="Inspect patch OSM">
        <p>
          Scan the patch for possible internal duplicates. These candidates are for review only; the
          patch is not normalized or otherwise changed before merging.
        </p>

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
              setChangesetReviewPurpose("diagnostic");
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

      <Step step="direct-merge" title="Direct merge">
        <p>
          Preview the patch entities that will be added to the base and the same-ID base features
          they will replace. The uploaded inputs remain unchanged during this review.
        </p>

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
              startStepTask("Generating changeset", async () => {
                if (!base.osm || !patch.osm) throw Error("Missing data to generate changes");
                setChangesetReviewPurpose("preview");
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
            Generate direct changes
          </ActionButton>
        </ButtonGroup>
      </Step>

      <Step step="review-changeset" title="Review changeset">
        {changesetReviewPurpose === "apply" ? (
          <p>
            Review the proposed edits produced in the previous step. Apply the changes to update the
            base OSM before moving forward.
          </p>
        ) : changesetReviewPurpose === "diagnostic" ? (
          <p>
            Review these possible duplicates as diagnostics. They are not automatically safe to
            merge, and continuing will leave the input file unchanged.
          </p>
        ) : (
          <p>
            Review this cumulative merge preview. Approving the step keeps the uploaded base
            unchanged while the next preview is regenerated from the original base and patch.
          </p>
        )}
        <ButtonGroup className="w-full">
          <ActionButton className="flex-1" icon={<DownloadIcon />} onAction={downloadJsonChanges}>
            Download JSON changes
          </ActionButton>
          <ButtonGroupSeparator />
          <ActionButton
            className="flex-1"
            disabled
            icon={<DownloadIcon />}
            onAction={async () => {}}
          >
            Download .osc changes
          </ActionButton>
        </ButtonGroup>
        {changesetStats && base.osm && (
          <Card>
            <CardHeader>
              {changesetReviewPurpose === "diagnostic"
                ? "Diagnostic candidates"
                : "Merge changeset"}
            </CardHeader>
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

        {changesetReviewPurpose === "diagnostic" ? (
          <ActionButton
            onAction={async () => {
              setChangesetStats(null);
              nextStep();
            }}
            icon={<ArrowRightIcon />}
          >
            Continue without applying
          </ActionButton>
        ) : changesetReviewPurpose === "preview" ? (
          <ActionButton
            onAction={async () => {
              setChangesetStats(null);
              nextStep();
            }}
            icon={<ArrowRightIcon />}
          >
            Approve step and continue
          </ActionButton>
        ) : changesetStats == null || hasZeroChanges ? (
          <ActionButton
            onAction={async () => {
              if (completesVerifiedMerge) showVerifiedMergeResult();
              else nextStep();
            }}
            icon={<ArrowRightIcon />}
          >
            No changes, go to next step
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
            Apply all changes
          </ActionButton>
        )}
      </Step>

      <Step step="match-imported-data" title="Match imported data">
        <p>
          Discover non-exact imported entities near the untouched base. Automatic matches must be
          unique and structurally compatible; ambiguous or routing-affecting candidates stay here
          for review.
        </p>
        <p>
          The base IDs, geometry, way references, and relation membership remain authoritative.
          Accepted network attachments rewrite only imported patch references.
        </p>

        <ActionButton
          disabled={!base.osm || !patch.osm || !conflationOptions}
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
            onDecision={updateConflationDecision}
            onDecisions={updateConflationDecisions}
            onFilterChange={updateConflationFilter}
            onPageChange={loadConflationPage}
          />
        ) : null}

        <ButtonGroup className="w-full">
          <ActionButton className="flex-1" icon={<ArrowLeft />} onAction={async () => prevStep()}>
            Back
          </ActionButton>
          <ButtonGroupSeparator />
          <ActionButton
            className="flex-1"
            disabled={!conflationSummary}
            icon={<ArrowRightIcon />}
            onAction={async () => nextStep()}
          >
            Continue with reviewed matches
          </ActionButton>
        </ButtonGroup>
      </Step>

      <Step step="deduplicate-nodes" title="Reconcile matching entities">
        <p>
          Regenerate the direct merge from the untouched inputs, identify uniquely matching and
          compatible patch entities in the base, then reconcile their references. Ambiguous
          proximity matches and routing-critical tag conflicts are left unchanged.
        </p>

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
              startStepTask("Preparing direct merge changeset", async () => {
                return generateVerifiedChangeset(false);
              })
            }
          >
            Skip reconciliation
          </ActionButton>
          <ButtonGroupSeparator />
          <ActionButton
            className="flex-1"
            icon={<FileDiff />}
            onAction={() =>
              startStepTask("Reconciling matching nodes and ways", async () => {
                return generateVerifiedChangeset(true);
              })
            }
          >
            Reconcile matching entities
          </ActionButton>
        </ButtonGroup>
      </Step>

      <Step step="create-intersections" title="Create intersections">
        <div className="flex flex-col gap-2">
          <p>
            Scan new ways for crossings with existing ways and flag the segments that should share
            intersection nodes based on their tags.
          </p>
          <p>
            We quickly search for nearby ways and keep only those whose tags allow an intersection:
            both must be linear, include a `highway` tag, and have compatible layer, level, bridge,
            tunnel, and covered context.
          </p>
          <p>
            For each candidate we locate the precise crossover point. Existing nodes at that point
            on either way are reused; otherwise we create a new node.
          </p>
          <p>
            Finally, we update the way geometries so they reference the chosen intersection node.
            You can review and apply those edits in the next screen.
          </p>
        </div>

        <ButtonGroup className="w-full">
          <ActionButton
            className="flex-1"
            icon={<SkipForwardIcon />}
            onAction={async () => showVerifiedMergeResult()}
          >
            Skip
          </ActionButton>
          <ButtonGroupSeparator />
          <ActionButton
            className="flex-1"
            icon={<FileDiff />}
            onAction={() =>
              startStepTask("Generating changeset", async () => {
                if (!base.osm || !patch.osm) throw Error("Missing data to generate changes");
                setChangesetReviewPurpose("apply");
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
            Create intersections
          </ActionButton>
        </ButtonGroup>
      </Step>

      <Step step="inspect-final-osm" title="Inspect final merged OSM">
        <p>
          Review the merged OSM dataset, explore the results on the map, and download the new PBF
          when ready. Zoom in to inspect individual entities and confirm the applied changes.
        </p>

        {base.osm && (
          <>
            <Card>
              <CardHeader>New OSM PBF</CardHeader>
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
  isTransitioning,
  children,
}: {
  step: (typeof STEPS)[number];
  title: string;
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
        <CardHeader className="border-b-0">
          {stepIndex + 1 - hiddenConflationStepBeforeCurrent}: {title}
        </CardHeader>
      </Card>
      {children}
    </>
  );
}
