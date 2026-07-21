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
import {
  type ChangesetReviewPurpose,
  COMPLETE_MERGE_OPTIONS,
  finalizeVerifiedMerge,
  INTERSECTION_OPTIONS,
  verifiedBaseMergeOptions,
  WITHIN_DATASET_DIAGNOSTIC_OPTIONS,
} from "../lib/merge-workflow";
import { showSaveFilePickerWithFallback } from "../lib/save-file-picker";
import { cn } from "../lib/utils";
import { BASE_OSM_KEY, PATCH_OSM_KEY } from "../settings";
import { changesetStatsAtom } from "../state/changes";
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
  "deduplicate-nodes",
  "review-changeset",
  "create-intersections",
  "review-changeset",
  "inspect-final-osm",
  "run-all-steps",
] as const;

const stepIndexAtom = atom<number>(0);
const changesetReviewPurposeAtom = atom<ChangesetReviewPurpose>("apply");
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
  const flyToEntity = useFlyToEntity();
  const flyToOsmBounds = useFlyToOsmBounds();
  const selectedEntity = useAtomValue(selectedEntityAtom);
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const [stepIndex, setStepIndex] = useAtom(stepIndexAtom);
  const [mergeAbortController, setMergeAbortController] = useAtom(mergeAbortControllerAtom);
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);

  const prevStep = () => {
    selectEntity(null, null);
    setStepIndex((s) => s - 1);
  };
  const nextStep = () => {
    selectEntity(null, null);
    setStepIndex((s) => s + 1);
  };
  const goToStep = (step: number | (typeof STEPS)[number]) => {
    const stepIndex = typeof step === "number" ? step : STEPS.indexOf(step);
    selectEntity(null, null);
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
            !base.osm || !patch.osm ? "opacity-50 pointer-events-none" : "",
          )}
        >
          <Item
            render={
              <button
                type="button"
                onClick={() => {
                  setChangesetStats(null);
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
                onClick={async () => {
                  goToStep("run-all-steps");

                  const abortController = new AbortController();
                  setMergeAbortController(abortController);

                  const task = Log.startTask("Running all merge steps, please wait...");
                  if (!base.osm) throw Error("Base OSM is not loaded");
                  if (!patch.osm) throw Error("Patch OSM is not loaded");

                  try {
                    setChangesetStats(null);
                    const merged = await osmWorker.merge(
                      base.osm.id,
                      patch.osm.id,
                      COMPLETE_MERGE_OPTIONS,
                    );

                    // Check if cancelled before applying results
                    if (abortController.signal.aborted) {
                      task.end("Merge cancelled by user");
                      goToStep("select-osm-pbf-files");
                      return;
                    }

                    // Use setMergedOsm to properly update file info for the new merged result
                    const mergedName = makeMergedDownloadName(
                      base.fileInfo?.fileName,
                      patch.fileInfo?.fileName,
                    );
                    await base.setMergedOsm(merged.id, mergedName);
                    patch.setOsm(null);

                    task.end("All merge steps completed");
                    goToStep("inspect-final-osm");
                  } catch (error) {
                    if (abortController.signal.aborted) {
                      task.end("Merge cancelled by user");
                      goToStep("select-osm-pbf-files");
                    } else {
                      task.end(
                        `Merge failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                        "error",
                      );
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
                if (!base.osm || !patch.osm) throw Error("Missing data to generate changes");
                setChangesetReviewPurpose("apply");
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
            Skip reconciliation
          </ActionButton>
          <ButtonGroupSeparator />
          <ActionButton
            className="flex-1"
            icon={<FileDiff />}
            onAction={() =>
              startStepTask("Reconciling matching nodes and ways", async () => {
                if (!base.osm || !patch.osm) throw Error("Missing data to generate changes");
                setChangesetReviewPurpose("apply");
                const results = await osmWorker.generateChangeset(
                  base.osm.id,
                  patch.osm.id,
                  verifiedBaseMergeOptions(true),
                );
                setChangesetStats(results);
                return changeStatsSummary(results);
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
  if (step !== currentStep) return null;
  if (isTransitioning === true) return <LoadingState>Please wait...</LoadingState>;
  return (
    <>
      <Card>
        <CardHeader className="border-b-0">
          {stepIndex + 1}: {title}
        </CardHeader>
      </Card>
      {children}
    </>
  );
}
