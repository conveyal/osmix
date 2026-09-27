import {
  changesetStatsAtom,
  committedMutationOsmId,
  mergedOsmRefreshRetryId,
  saveChangesetJson,
  selectOsmEntityAtom,
  suffixOsmPbfName,
  TaskAlreadyRunningError,
  Tasks,
  useOsmixRemote,
  type UseOsmFileReturn,
  WITHIN_DATASET_DEDUPLICATION_OPTIONS,
} from "@osmix/app-core";
import {
  ActionButton,
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Details,
  DetailsContent,
  DetailsSummary,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  LoadingState,
  SectionTitle,
} from "@osmix/ui";
import { useAtom, useSetAtom } from "jotai";
import { DownloadIcon, FileJsonIcon, SearchCodeIcon, WandSparklesIcon } from "lucide-react";
import type { OsmChangesetStats } from "osmix";
import { Suspense, useState } from "react";

import { useSelectAndFlyToEntity } from "../hooks/map.ts";
import { FullIndexRequired, hasFullNodeIndex } from "./full-index-required.tsx";
import ChangesSummary, {
  ChangesFilters,
  ChangesList,
  ChangesPagination,
} from "./osm-changes-summary.tsx";
import { SaveToDiskNotice } from "./save-to-disk-notice.tsx";

const DEDUPLICATED_SUFFIX = "deduplicated";

/** "1 duplicate way", "2 duplicate nodes". */
function countDuplicates(count: number, noun: "node" | "way") {
  return `${count.toLocaleString()} duplicate ${noun}${count === 1 ? "" : "s"}`;
}

/** What the exact duplicate scan finds, what applying it changes, and what it keeps. */
export const DUPLICATE_SCAN_GUIDE = {
  finds: [
    "Nodes at the same seven-decimal OSM coordinate with no conflicting tags and compatible grade, access, and connected-way context.",
    "Ways with identical ordered node references and compatible routing semantics.",
    "Nearby but non-identical entities are not reported as exact duplicates.",
  ],
  applies: [
    "Each duplicate is deleted in favor of the compatible entity with the highest ID.",
    "Way node references and relation members that pointed at a deleted duplicate are rewritten to its surviving entity.",
    "The result replaces the dataset open in this tab. The original file and any stored copy are not changed.",
  ],
  keeps: [
    "Scanning alone never changes the dataset. Nothing changes until you confirm Apply.",
    "Coordinates, tags, and every entity that is not a duplicate stay as they are.",
  ],
  caution:
    "A candidate is evidence for review, not proof of an error. Check a sample of candidates on the map before applying. To undo, reopen the original file or its stored copy.",
} as const;

interface AppliedFixes {
  osmId: string;
  stats: OsmChangesetStats;
}

interface RefreshTarget {
  osmId: string;
  fileName: string;
  synchronize: boolean;
  stats: OsmChangesetStats;
}

/**
 * Find exact duplicate nodes and ways inside one dataset, review them on the map, apply them to
 * the open dataset, and download the cleaned PBF. The download is what users open in Merge.
 */
export function DuplicateFixes({ osmFile }: { osmFile: UseOsmFileReturn }) {
  const remote = useOsmixRemote();
  const selectAndFlyToEntity = useSelectAndFlyToEntity();
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The dialog keeps the counts it opened with, so its close animation can finish after the
  // candidates are cleared.
  const [confirmStats, setConfirmStats] = useState<OsmChangesetStats | null>(null);
  const [applied, setApplied] = useState<AppliedFixes | null>(null);
  const [pendingRefresh, setPendingRefresh] = useState<(RefreshTarget & { error: string }) | null>(
    null,
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const osm = osmFile.osm;
  if (!osm || !osmFile.osmInfo) return null;
  const candidates = changesetStats?.osmId === osm.id ? changesetStats : null;
  const appliedHere = applied?.osmId === osm.id ? applied : null;

  const scan = async () => {
    setApplied(null);
    setJsonError(null);
    await Tasks.run(
      "Find duplicate nodes and ways",
      async () => {
        const stats = await remote.generateChangeset(
          osm.id,
          osm.id,
          WITHIN_DATASET_DEDUPLICATION_OPTIONS,
        );
        setChangesetStats(stats);
        return stats;
      },
      {
        summary: (stats) => `Found ${stats.totalChanges.toLocaleString()} duplicate candidates`,
      },
    );
  };

  /** Load the applied result into the UI. A failure keeps a refresh-only retry. */
  const refresh = async (target: RefreshTarget) => {
    let needsSynchronization = target.synchronize;
    try {
      if (target.synchronize) await remote.synchronizeDataset(target.osmId);
      needsSynchronization = false;
      const refreshed = await osmFile.setMergedOsm(target.osmId, target.fileName);
      setPendingRefresh(null);
      setApplied({ osmId: refreshed.id, stats: target.stats });
    } catch (error) {
      setPendingRefresh({
        ...target,
        synchronize: needsSynchronization,
        osmId: mergedOsmRefreshRetryId(error, target.osmId),
        error: error instanceof Error ? error.message : "The dataset could not be refreshed.",
      });
      throw error;
    }
  };

  const applyFixes = async () => {
    if (!candidates) throw Error("Duplicate candidates are not loaded.");
    const stats = candidates;
    const fileName = suffixOsmPbfName(
      osmFile.fileInfo?.fileName ?? `${osm.id}.pbf`,
      DEDUPLICATED_SUFFIX,
    );
    try {
      await Tasks.run(
        "Apply duplicate fixes",
        async () => {
          let synchronize = false;
          try {
            await remote.applyChangesAndReplace(osm.id);
          } catch (error) {
            if (committedMutationOsmId(error, "applyChangesAndReplace") !== osm.id) throw error;
            synchronize = true;
            Tasks.message("Fixes were applied; refreshing worker copies.", "warn");
          }
          setConfirmOpen(false);
          setChangesetStats(null);
          selectEntity(null, null);
          await refresh({ osmId: osm.id, fileName, synchronize, stats });
          return stats;
        },
        { summary: (result) => `Applied ${result.totalChanges.toLocaleString()} changes` },
      );
    } catch (error) {
      // The task records the failure; only a lock violation is a programming error.
      if (error instanceof TaskAlreadyRunningError) throw error;
    }
  };

  const downloadJson = async () => {
    if (!candidates) return;
    setJsonError(null);
    try {
      await saveChangesetJson(remote, candidates, "osm-duplicate-candidates.json");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setJsonError(
        `Candidates could not be saved. ${error instanceof Error ? error.message : "Try again."}`,
      );
    }
  };

  return (
    <>
      <Card>
        <CardHeader>Duplicate nodes and ways</CardHeader>
        <CardContent className="flex flex-col gap-2">
          <FullIndexRequired operation="Duplicate detection" osmFile={osmFile} />
          <p>
            Find nodes at the same OSM coordinate and ways with the same ordered nodes. Review the
            candidates on the map, apply them to remove the duplicates, then download the cleaned
            PBF. Do this for each input before you merge it.
          </p>
        </CardContent>
        <CardContent className="p-0">
          <DuplicateScanGuide />
        </CardContent>
        <CardContent className="flex flex-col gap-2">
          {pendingRefresh ? (
            <Alert variant="destructive" title="The fixed dataset needs to be refreshed">
              <p>{pendingRefresh.error}</p>
              <p>The fixes were already applied. Refresh the dataset before downloading it.</p>
              <ActionButton
                onAction={async () => {
                  const { error: _error, ...target } = pendingRefresh;
                  await Tasks.run("Refresh fixed dataset", () => refresh(target));
                }}
              >
                Refresh dataset
              </ActionButton>
            </Alert>
          ) : null}
          {appliedHere ? (
            <Alert
              variant="success"
              title={`Applied ${appliedHere.stats.totalChanges.toLocaleString()} changes`}
            >
              <p>
                Removed {countDuplicates(appliedHere.stats.deduplicatedNodes, "node")} and{" "}
                {countDuplicates(appliedHere.stats.deduplicatedWays, "way")}. Download the cleaned
                PBF, then open it in Merge.
              </p>
            </Alert>
          ) : null}
          {appliedHere ? (
            <>
              <ActionButton
                icon={<DownloadIcon aria-hidden="true" />}
                onAction={() => osmFile.downloadOsm()}
              >
                Download deduplicated PBF
              </ActionButton>
              <SaveToDiskNotice />
            </>
          ) : null}
          <ActionButton
            disabled={!hasFullNodeIndex(osmFile.osmInfo) || pendingRefresh !== null}
            icon={<SearchCodeIcon aria-hidden="true" />}
            variant={appliedHere || candidates ? "outline" : "default"}
            onAction={scan}
          >
            Find duplicate nodes and ways
          </ActionButton>
        </CardContent>
      </Card>

      {candidates ? (
        <Card>
          <CardHeader>Duplicate candidates</CardHeader>
          <CardContent className="p-0">
            <ChangesSummary variant="deduplication" />
            <Suspense fallback={<LoadingState />}>
              <Details>
                <DetailsSummary>Changes</DetailsSummary>
                <DetailsContent>
                  <ChangesFilters />
                  <ChangesList setSelectedEntity={(entity) => selectAndFlyToEntity(osm, entity)} />
                  <ChangesPagination />
                </DetailsContent>
              </Details>
            </Suspense>
          </CardContent>
          {candidates.totalChanges > 0 ? (
            <CardContent className="flex flex-col gap-2">
              {jsonError ? <Alert variant="destructive">{jsonError}</Alert> : null}
              <ActionButton
                icon={<FileJsonIcon aria-hidden="true" />}
                variant="outline"
                onAction={downloadJson}
              >
                Download JSON changes
              </ActionButton>
              <Button
                onClick={() => {
                  setConfirmStats(candidates);
                  setConfirmOpen(true);
                }}
              >
                <WandSparklesIcon aria-hidden="true" />
                Apply fixes
              </Button>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {confirmStats ? (
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Apply duplicate fixes?</DialogTitle>
              <DialogDescription>
                Remove {countDuplicates(confirmStats.deduplicatedNodes, "node")} and{" "}
                {countDuplicates(confirmStats.deduplicatedWays, "way")}. The compatible entity with
                the highest ID survives, and references to each duplicate are rewritten to it.
              </DialogDescription>
            </DialogHeader>
            <p>
              This replaces the dataset open in this tab. The original file and any stored copy are
              not changed.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <ActionButton onAction={applyFixes}>
                Apply {confirmStats.totalChanges.toLocaleString()} changes
              </ActionButton>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function GuideSection({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <div role="heading" aria-level={3}>
        <SectionTitle>{title}</SectionTitle>
      </div>
      <ul className="list-disc pl-4">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** The collapsed "How this scan works" explanation. */
export function DuplicateScanGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Details defaultOpen={defaultOpen}>
      <DetailsSummary>How this scan works</DetailsSummary>
      <DetailsContent>
        <div className="flex flex-col gap-2 bg-muted/50 p-inset" data-slot="duplicate-scan-guide">
          <GuideSection title="What it finds" items={DUPLICATE_SCAN_GUIDE.finds} />
          <GuideSection title="What applying changes" items={DUPLICATE_SCAN_GUIDE.applies} />
          <GuideSection title="What stays the same" items={DUPLICATE_SCAN_GUIDE.keeps} />
          <Alert variant="warning" role="note">
            <p>{DUPLICATE_SCAN_GUIDE.caution}</p>
          </Alert>
        </div>
      </DetailsContent>
    </Details>
  );
}
