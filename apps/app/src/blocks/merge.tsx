import {
  FullIndexRequired,
  hasFullNodeIndex,
  OsmDatasetSection,
  OsmInfoTable,
  pagePath,
  StoredOsmList,
  useFlyToOsmBounds,
} from "@osmix/app-components";
import {
  committedMutationOsmId,
  mergedOsmRefreshRetryId,
  osmLoadingAbortControllerAtom,
  selectOsmEntityAtom,
  showSaveFilePickerWithFallback,
  type TaskHandle,
  TaskAlreadyRunningError,
  Tasks,
  type UseOsmFileReturn,
  useOsmixRemote,
  writeJsonReport,
} from "@osmix/app-core";
import { ActionButton, Alert, Step, useTaskLock } from "@osmix/ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ArrowLeftIcon, DownloadIcon, MergeIcon } from "lucide-react";
import type {
  MergePlanBulkRequest,
  MergePlanFilter,
  MergePlanOverview,
  PatchIdMode,
  PlanDecision,
} from "osmix";
import { useState } from "react";
import { Link } from "wouter";

import { ConflationConfig } from "../components/conflation-config";
import { MergeCompletionSummary } from "../components/merge-completion-summary";
import { MergeResult } from "../components/merge-result";
import { OsmInputSection } from "../components/osm-input-section";
import { PatchIdNotice } from "../components/patch-id-notice";
import { PlanInputs } from "../components/plan-inputs";
import { PLAN_PAGE_SIZE, PlanReview } from "../components/plan-review";
import { PlanSummary } from "../components/plan-summary";
import { StepActions } from "../components/step-actions";
import { firstInvalidConflationInputId, toOsmConflationOptions } from "../lib/conflation-workflow";
import {
  buildMergePlanOptions,
  makeMergedDownloadName,
  makePlanOscName,
  withDecision,
} from "../lib/merge-plan-workflow";
import { useBaseOsm, usePatchOsm } from "../lib/merge-slots";
import { useSelectPlanFeature } from "../lib/use-select-plan-feature";
import { BASE_OSM_KEY, PATCH_OSM_KEY } from "../settings";
import {
  mergeCompletionAtom,
  mergeRunInputsAtom,
  mergeStepAtom,
  pendingMergedRefreshAtom,
  updateMergeOutcomeAtom,
} from "../state/merge-outcome";
import {
  conflationFormAtom,
  mergeIdenticalPointsAtom,
  patchIdModeAtom,
  planFilterAtom,
  planLayerAtom,
  planOverviewAtom,
  planPageAtom,
  planPageIndexAtom,
  resetMergePlanAtom,
  selectedPlanFeatureAtom,
} from "../state/merge-plan";

const STEP_NUMBER = { inputs: 1, review: 2, automatic: undefined, result: 3 } as const;

/**
 * The Merge workflow: load the inputs and choose how to read them, review the plan feature by
 * feature (or apply it automatically), then inspect and download the result.
 */
export default function MergeBlock() {
  const remote = useOsmixRemote();
  const base = useBaseOsm();
  const patch = usePatchOsm();
  const [step, setStep] = useAtom(mergeStepAtom);
  const completion = useAtomValue(mergeCompletionAtom);
  const runInputs = useAtomValue(mergeRunInputsAtom);
  const [pendingRefresh, setPendingRefresh] = useAtom(pendingMergedRefreshAtom);
  const updateOutcome = useSetAtom(updateMergeOutcomeAtom);
  const conflationForm = useAtomValue(conflationFormAtom);
  const mergeIdenticalPoints = useAtomValue(mergeIdenticalPointsAtom);
  const [patchIds, setPatchIds] = useAtom(patchIdModeAtom);
  const [overview, setOverview] = useAtom(planOverviewAtom);
  const [filter, setFilter] = useAtom(planFilterAtom);
  const [page, setPage] = useAtom(planPageAtom);
  const [pageIndex, setPageIndex] = useAtom(planPageIndexAtom);
  const setLayer = useSetAtom(planLayerAtom);
  const [selected, setSelected] = useAtom(selectedPlanFeatureAtom);
  const resetPlan = useSetAtom(resetMergePlanAtom);
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const selectFeature = useSelectPlanFeature();
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);
  const flyToOsmBounds = useFlyToOsmBounds();
  const taskLocked = useTaskLock();
  const [positiveIds, setPositiveIds] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const baseFileName = base.file?.name ?? base.fileInfo?.fileName;
  const patchFileName = patch.file?.name ?? patch.fileInfo?.fileName;
  const mergedName = makeMergedDownloadName(
    runInputs?.baseName ?? baseFileName,
    runInputs?.patchName ?? patchFileName,
  );

  const goTo = (next: typeof step) => {
    selectEntity(null, null);
    setSelected(null);
    setStep(next);
  };

  const resetDerivedState = () => {
    setDownloadError(null);
    setPendingRefresh(null);
    updateOutcome({ type: "reset" });
    resetPlan();
    selectEntity(null, null);
  };

  /** Plan options from the settings, or null after focusing the first invalid field. */
  const planOptions = (mode: PatchIdMode = patchIds, decisions?: PlanDecision[]) => {
    const invalid = firstInvalidConflationInputId(conflationForm);
    if (invalid) {
      document.getElementById(invalid)?.focus();
      return null;
    }
    return {
      ...buildMergePlanOptions({
        matching: toOsmConflationOptions(conflationForm),
        mergeIdenticalPoints,
        patchIds: mode,
      }),
      ...(decisions ? { decisions } : {}),
    };
  };

  const loadPage = async (baseOsmId: string, requested: number) => {
    let result = await remote.getMergePlanPage(baseOsmId, requested, PLAN_PAGE_SIZE);
    const last = Math.max(0, result.totalPages - 1);
    if (requested > last) result = await remote.getMergePlanPage(baseOsmId, last, PLAN_PAGE_SIZE);
    setPage(result);
    setPageIndex(Math.min(requested, last));
  };

  /** Show a new or replanned plan: its overview, the current page, the map layer, the open row. */
  const showPlan = async (baseOsmId: string, next: MergePlanOverview, pageNumber: number) => {
    setOverview(next);
    updateOutcome({ type: "planned", plan: next });
    const [layer, detail] = await Promise.all([
      remote.getMergePlanLayer(baseOsmId),
      selected ? remote.getMergePlanFeature(baseOsmId, selected.key) : null,
      loadPage(baseOsmId, pageNumber),
    ]);
    setLayer(layer);
    setSelected(detail);
  };

  const beginRun = () =>
    updateOutcome({
      type: "begin",
      inputs: {
        baseName: baseFileName ?? "Base dataset",
        patchName: patchFileName ?? "Imported dataset",
        matchingEnabled: conflationForm.enabled,
      },
    });

  const reviewPlan = async () => {
    const options = planOptions();
    if (!options || !base.osm || !patch.osm) return;
    const baseOsmId = base.osm.id;
    const patchOsmId = patch.osm.id;
    beginRun();
    resetPlan();
    await runTask("Plan merge", async () => {
      const planned = await remote.planMerge(baseOsmId, patchOsmId, options);
      await showPlan(baseOsmId, planned, 0);
      goTo("review");
      return `Planned ${planned.featureCount.toLocaleString()} imported features`;
    });
  };

  const replanWithPatchIds = async (mode: PatchIdMode) => {
    if (!base.osm || !patch.osm) return;
    const options = planOptions(mode, overview?.decisions);
    if (!options) return;
    const baseOsmId = base.osm.id;
    const patchOsmId = patch.osm.id;
    setPatchIds(mode);
    await runTask("Plan merge", async () => {
      const planned = await remote.planMerge(baseOsmId, patchOsmId, options);
      await remote.setMergePlanFilter(baseOsmId, filter);
      await showPlan(baseOsmId, planned, 0);
      return mode === "new" ? "Replanned with every patch feature new" : "Replanned";
    });
  };

  const decide = async (
    proposalId: string,
    action: PlanDecision["action"] | null,
    excludes: readonly string[],
  ) => {
    if (!base.osm || !overview) return;
    const baseOsmId = base.osm.id;
    const decisions = withDecision(overview.decisions, proposalId, action, excludes);
    await runTask("Update plan", async () => {
      const next = await remote.setMergePlanDecisions(baseOsmId, decisions);
      await showPlan(baseOsmId, next, pageIndex);
      return "Plan updated";
    });
  };

  const applyBulk = async (request: MergePlanBulkRequest) => {
    if (!base.osm) return;
    const baseOsmId = base.osm.id;
    await runTask("Choose for shown features", async () => {
      const result = await remote.applyMergePlanBulk(baseOsmId, request);
      await showPlan(baseOsmId, result.overview, pageIndex);
      const skipped =
        result.skipped > 0
          ? `; ${result.skipped.toLocaleString()} need their own choice (removals, or ` +
            "proposals that exclude others)"
          : "";
      return `Updated ${result.changed.toLocaleString()} choices${skipped}`;
    });
  };

  const changeFilter = async (next: MergePlanFilter) => {
    if (!base.osm) return;
    const baseOsmId = base.osm.id;
    await remote.setMergePlanFilter(baseOsmId, next);
    setFilter(next);
    await loadPage(baseOsmId, 0);
  };

  const downloadOsc = async () => {
    if (!base.osm) return;
    setDownloadError(null);
    try {
      const fileHandle = await showSaveFilePickerWithFallback({
        suggestedName: makePlanOscName(baseFileName, patchFileName),
      });
      if (!fileHandle) return;
      const osc = await remote.getMergePlanOsc(base.osm.id);
      const stream = await fileHandle.createWritable();
      await stream.write(osc);
      await stream.close();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setDownloadError(
        `The osmChange file could not be saved. ${error instanceof Error ? error.message : "Try again."}`,
      );
    }
  };

  /** Show the applied result. A failure keeps a refresh-only retry; nothing is applied again. */
  const refreshResult = async (osmId: string, synchronize: boolean) => {
    const pending = { osmId, fileName: mergedName, synchronize };
    setPendingRefresh(pending);
    let needsSynchronization = synchronize;
    try {
      if (synchronize) await remote.synchronizeDataset(osmId);
      needsSynchronization = false;
      await base.setMergedOsm(osmId, mergedName);
      updateOutcome({ type: "refreshed" });
      setPendingRefresh(null);
    } catch (error) {
      setPendingRefresh({
        ...pending,
        synchronize: needsSynchronization,
        osmId: mergedOsmRefreshRetryId(error, osmId),
        error:
          error instanceof Error ? error.message : "The merged dataset could not be refreshed.",
      });
      throw error;
    }
  };

  const finish = () => {
    updateOutcome({ type: "complete" });
    patch.setOsm(null);
    goTo("result");
  };

  /**
   * Apply the current plan, then refresh. A committed apply is never retried; `onApplied` marks
   * the point after which the original inputs are gone.
   */
  const applyAndRefresh = async (task: TaskHandle, baseOsmId: string, onApplied = () => {}) => {
    let synchronize = false;
    await task.runStep("Apply plan", async () => {
      try {
        await remote.applyMergePlan(baseOsmId);
      } catch (error) {
        if (committedMutationOsmId(error, "applyMergePlan") !== baseOsmId) throw error;
        synchronize = true;
        task.message("The plan was applied; refreshing worker copies before continuing.");
      }
      updateOutcome({ type: "applied" });
      onApplied();
    });
    await task.runStep("Refresh result", () => refreshResult(baseOsmId, synchronize));
  };

  const applyReviewedPlan = async () => {
    if (!base.osm) return;
    const baseOsmId = base.osm.id;
    await runTask("Apply merge plan", async (task) => {
      await applyAndRefresh(task, baseOsmId);
      finish();
      return "Merge applied";
    });
  };

  const applyAutomatically = async () => {
    const options = planOptions();
    if (!options || !base.osm || !patch.osm) return;
    const baseOsmId = base.osm.id;
    const patchOsmId = patch.osm.id;
    beginRun();
    resetPlan();
    const controller = new AbortController();
    const task = Tasks.start("Apply merge automatically", { controller });
    goTo("automatic");
    let applied = false;
    try {
      const planned = await task.runStep("Plan merge", () =>
        remote.planMerge(baseOsmId, patchOsmId, options),
      );
      setOverview(planned);
      updateOutcome({ type: "planned", plan: planned });
      if (controller.signal.aborted) {
        await remote.clearMergePlan(baseOsmId);
        task.cancelled("Merge cancelled");
        goTo("inputs");
        return;
      }
      await applyAndRefresh(task, baseOsmId, () => {
        applied = true;
      });
      if (controller.signal.aborted) {
        task.message(
          "Cancellation arrived after the plan was applied, so the merge was completed.",
          "warn",
        );
      }
      task.end("Merge applied");
      finish();
    } catch (error) {
      if (applied) {
        // The worker applied the plan; only showing it failed. The refresh alert retries that.
        task.fail(
          error,
          `The merge was applied, but the merged dataset could not be refreshed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        return;
      }
      if (controller.signal.aborted) {
        task.cancelled("Merge cancelled");
      } else {
        task.fail(
          error,
          `Merge failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
      goTo("inputs");
    }
  };

  const retryRefresh = async () => {
    if (!pendingRefresh) return;
    await runTask("Refresh merged dataset", async () => {
      await refreshResult(pendingRefresh.osmId, pendingRefresh.synchronize ?? false);
      finish();
      return "Merged dataset refreshed";
    });
  };

  const downloadReport = async () => {
    if (!completion) return;
    const fileHandle = await showSaveFilePickerWithFallback({
      suggestedName: "osmix-merge-outcome.json",
    });
    if (!fileHandle) return;
    const stream = await fileHandle.createWritable();
    // With positive IDs, the report maps each new feature's patch ID to its exported ID.
    const idMap =
      positiveIds && base.osmInfo ? { idMap: await remote.negativeIdMap(base.osmInfo.id) } : {};
    await writeJsonReport(stream, {
      format: "osmix-merge-outcome",
      version: 2,
      ...completion,
      ...idMap,
    });
  };

  const startNewMerge = async () => {
    await Promise.all([base.loadOsmFile(null), patch.loadOsmFile(null)]);
    resetDerivedState();
    goTo("inputs");
  };

  const clearInput = async (file: UseOsmFileReturn) => {
    if (overview && base.osm) await remote.clearMergePlan(base.osm.id);
    resetDerivedState();
    await file.loadOsmFile(null);
  };

  /**
   * Exchange the base and the patch, or move the only loaded one into the other slot. Both
   * copies happen before either old dataset is freed, since each slot copies from the other.
   */
  const swapInputs = async () => {
    if (!base.osm && !patch.osm) return;
    resetDerivedState();
    const baseState = base.snapshot();
    const previousBaseId = await base.copyStateFrom(patch.snapshot(), { releasePrevious: false });
    await patch.copyStateFrom(baseState);
    // Freeing waits for every worker, which may be drawing tiles; the swap need not.
    if (previousBaseId) {
      remote.delete(previousBaseId).catch((error: unknown) => {
        console.error(`Failed to free dataset ${previousBaseId}`, error);
      });
    }
  };

  const baseNeedsFull = base.osmInfo !== null && !hasFullNodeIndex(base.osmInfo);
  const patchNeedsFull = patch.osmInfo !== null && !hasFullNodeIndex(patch.osmInfo);
  if (baseNeedsFull || patchNeedsFull) {
    return (
      <>
        <OsmDatasetSection
          title="Base OSM"
          name="base OSM"
          osmFile={base}
          onClear={() => void clearInput(base)}
        />
        <OsmDatasetSection
          title="Patch OSM"
          name="patch OSM"
          osmFile={patch}
          onClear={() => void clearInput(patch)}
        />
        <div className="flex flex-col gap-2 p-inset">
          <FullIndexRequired operation="Merge" osmFile={base} />
          <FullIndexRequired operation="Merge" osmFile={patch} />
        </div>
      </>
    );
  }

  const inputSection = (file: UseOsmFileReturn, osmKey: string, kind: "base" | "patch") => (
    <OsmInputSection
      fileName={kind === "base" ? baseFileName : patchFileName}
      kind={kind}
      loaded={Boolean(file.osm)}
      onClear={() => clearInput(file)}
      onDownload={file.downloadOsm}
      {...(kind === "patch" && (base.osm || patch.osm) ? { onSwap: swapInputs } : {})}
      title={
        kind === "base"
          ? "Base OSM — authoritative existing dataset"
          : "Patch OSM — imported additions and updates"
      }
    >
      {file.osm ? (
        <OsmInfoTable
          defaultOpen={false}
          osm={file.osm}
          file={file.file}
          fileInfo={file.fileInfo}
        />
      ) : (
        <StoredOsmList
          osmKey={osmKey}
          // Base first: the patch's Open file is the primary action only once the base is loaded.
          primary={kind === "base" || Boolean(base.osm)}
          loadFailure={file.loadFailure}
          onDismissLoadFailure={file.clearLoadFailure}
          onReloadView={file.reloadWithViewProfile}
          openOsmPbfUrl={async (url) => {
            const controller = new AbortController();
            setLoadingState({ controller, osmKey });
            resetDerivedState();
            try {
              const osmInfo = await file.loadOsmPbfUrl(url, controller);
              if (osmInfo) flyToOsmBounds(osmInfo);
              return osmInfo;
            } finally {
              setLoadingState(null);
            }
          }}
          openOsmFile={async (source, fileType) => {
            const controller = new AbortController();
            setLoadingState({ controller, osmKey });
            resetDerivedState();
            try {
              const osmInfo =
                typeof source === "string"
                  ? await file.loadFromStorage(source, controller)
                  : await file.loadOsmFile(source, fileType, controller);
              if (osmInfo) flyToOsmBounds(osmInfo);
              return osmInfo;
            } finally {
              setLoadingState(null);
            }
          }}
        />
      )}
    </OsmInputSection>
  );

  const title = {
    inputs: "Choose the inputs",
    review: "Review the plan",
    automatic: "Applying the merge",
    result: "Merged result",
  }[step];
  const intro = {
    inputs:
      "Load the base and the import, then review the plan before anything changes, or apply it automatically.",
    review:
      "Nothing has changed yet. Each imported feature shows what the plan does with it; choose where a proposal needs you, then apply.",
    automatic: "Planning and applying in one run. Progress and details are in Activity.",
    result: "The merge is applied. Export the result, or start a new merge.",
  }[step];

  return (
    <>
      <Step number={STEP_NUMBER[step]} title={title}>
        {pendingRefresh?.error ? (
          <Alert variant="destructive" title="The merged dataset needs to be refreshed">
            <p>{pendingRefresh.error}</p>
            <p>
              The worker already applied the plan. Refresh the displayed result before continuing or
              downloading.
            </p>
            <ActionButton onAction={retryRefresh}>Refresh merged dataset</ActionButton>
            <p>
              If refreshing cannot recover the dataset, reload this page and load both original
              input files to start again.
            </p>
          </Alert>
        ) : null}
        <p>{intro}</p>
        {step === "inputs" ? (
          <Alert title="Check each input in Inspect first">
            <p>
              Merge does not scan inputs for duplicates inside one file. Open each file in{" "}
              <Link href={pagePath("inspect")} className="text-info underline">
                Inspect
              </Link>{" "}
              to find and fix duplicate nodes and ways, then save the cleaned file and open it here
              from the stored files.
            </p>
          </Alert>
        ) : null}
        {step === "review" && overview ? (
          <PatchIdNotice
            mode={patchIds}
            replacesBase={overview.summary.replacesBase}
            onChange={replanWithPatchIds}
          />
        ) : null}
      </Step>

      {step === "inputs" ? (
        <>
          {inputSection(base, BASE_OSM_KEY, "base")}
          {inputSection(patch, PATCH_OSM_KEY, "patch")}
          <ConflationConfig />
          <PlanInputs
            disabled={!base.osm || !patch.osm || taskLocked}
            onApplyAutomatically={applyAutomatically}
            onReviewPlan={reviewPlan}
          />
        </>
      ) : null}

      {step === "review" && overview && page ? (
        <>
          <PlanSummary overview={overview} />
          <PlanReview
            detail={selected}
            filter={filter}
            page={page}
            pageIndex={pageIndex}
            onBulk={applyBulk}
            onDecide={decide}
            onFilterChange={changeFilter}
            onPageChange={async (next) => {
              if (base.osm) await loadPage(base.osm.id, next);
            }}
            onSelect={selectFeature}
          />
          <div className="flex flex-col gap-2 p-inset">
            {downloadError ? <Alert variant="destructive">{downloadError}</Alert> : null}
            <StepActions aria-label="Plan review actions">
              <ActionButton
                icon={<ArrowLeftIcon />}
                variant="outline"
                onAction={async () => {
                  if (base.osm) await remote.clearMergePlan(base.osm.id);
                  resetPlan();
                  goTo("inputs");
                }}
              >
                Back to inputs
              </ActionButton>
              <ActionButton icon={<DownloadIcon />} variant="outline" onAction={downloadOsc}>
                Export osmChange (.osc)
              </ActionButton>
              <ActionButton
                icon={<MergeIcon />}
                disabled={overview.diagnostics.integrity.length > 0 || pendingRefresh !== null}
                onAction={applyReviewedPlan}
              >
                Apply plan
              </ActionButton>
            </StepActions>
          </div>
        </>
      ) : null}

      {step === "result" ? (
        <MergeResult
          base={base}
          plan={completion?.plan ?? null}
          positiveIds={positiveIds}
          onPositiveIdsChange={setPositiveIds}
          onClear={() => clearInput(base)}
          onStartNew={startNewMerge}
          summary={
            completion ? (
              <MergeCompletionSummary completion={completion} onDownloadReport={downloadReport} />
            ) : null
          }
        />
      ) : null}
    </>
  );
}

/** Run one step of the workflow as a task. A failure is recorded by the task and stays here. */
async function runTask(title: string, fn: (task: TaskHandle) => Promise<string>) {
  try {
    await Tasks.run(title, fn, { summary: (summary) => summary });
  } catch (error) {
    if (error instanceof TaskAlreadyRunningError) throw error;
  }
}
