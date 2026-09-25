import {
  useOsmFile,
  changesetStatsAtom,
  selectOsmEntityAtom,
  osmLoadingAbortControllerAtom,
  Tasks,
} from "@osmix/app-core";
import { useOsmixRemote } from "@osmix/app-core";
import { WITHIN_DATASET_DIAGNOSTIC_OPTIONS } from "@osmix/app-core";
import {
  ActionButton,
  Details,
  DetailsContent,
  DetailsSummary,
  LoadingState,
  Card,
  CardContent,
  CardHeader,
} from "@osmix/ui";
import { useAtom, useSetAtom } from "jotai";
import type { OsmInfo } from "osmix";
import type { OsmFileType } from "osmix";
import { Suspense } from "react";

import { useFlyToEntity, useFlyToOsmBounds } from "../hooks/map.ts";
import { appOrigin } from "../lib/app-origin.ts";
import { FullIndexRequired, hasFullNodeIndex } from "./full-index-required.tsx";
import ChangesSummary, {
  ChangesFilters,
  ChangesList,
  ChangesPagination,
} from "./osm-changes-summary.tsx";
import { OsmDatasetCard } from "./osm-dataset-card.tsx";
import { OsmSourceLinks } from "./osm-source-links.tsx";
import StoredOsmList from "./stored-osm-list.tsx";

/**
 * Sidebar panel for inspecting one loaded dataset: source links and stored files while the
 * slot is empty, then the dataset card (file info, save, download, clear), the within-dataset
 * duplicate diagnostics and their results once a dataset is loaded.
 */
export function InspectPanel({
  osmKey,
  openOsmFile,
}: {
  /** The osm slot this panel inspects. */
  osmKey: string;
  openOsmFile: (file: File | string, fileType?: OsmFileType) => Promise<OsmInfo | null>;
}) {
  const remote = useOsmixRemote();
  const flyToEntity = useFlyToEntity();
  const flyToOsmBounds = useFlyToOsmBounds();
  const baseOsm = useOsmFile(osmKey);
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);
  const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom);

  if (!baseOsm.osm || !baseOsm.osmInfo || !baseOsm.fileInfo) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">
          Open an OSM file to inspect, or extract a region with the{" "}
          <a href={appOrigin("extract")} className="text-info underline">
            Extract app
          </a>
        </p>
        <OsmSourceLinks
          openOsmPbfUrl={async (url) => {
            const abortController = new AbortController();
            setLoadingState({ controller: abortController, osmKey: osmKey });
            try {
              const osmInfo = await baseOsm.loadOsmPbfUrl(url, abortController);
              if (osmInfo) flyToOsmBounds(osmInfo);
              return osmInfo;
            } finally {
              setLoadingState(null);
            }
          }}
        />
        <StoredOsmList
          osmKey={osmKey}
          loadFailure={baseOsm.loadFailure}
          onDismissLoadFailure={baseOsm.clearLoadFailure}
          onReloadView={baseOsm.reloadWithViewProfile}
          openOsmPbfUrl={async (url) => {
            const abortController = new AbortController();
            setLoadingState({ controller: abortController, osmKey: osmKey });
            try {
              const osmInfo = await baseOsm.loadOsmPbfUrl(url, abortController);
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
              osmKey: osmKey,
            });
            try {
              const osmInfo =
                typeof file === "string"
                  ? await baseOsm.loadFromStorage(file, abortController)
                  : await baseOsm.loadOsmFile(file, undefined, abortController);
              if (osmInfo) flyToOsmBounds(osmInfo);
              return osmInfo;
            } finally {
              setLoadingState(null);
            }
          }}
        />
      </div>
    );
  }

  const clearDataset = async () => {
    selectEntity(null, null);
    setChangesetStats(null);
    await baseOsm.loadOsmFile(null);
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <OsmDatasetCard title="Dataset" name="dataset" osmFile={baseOsm} onClear={clearDataset} />

      <Card>
        <CardHeader>Diagnostics</CardHeader>
        <CardContent className="flex flex-col gap-2">
          <FullIndexRequired operation="Duplicate detection" osmFile={baseOsm} />
          <p>
            Scan for possible duplicates without changing the dataset. Nearby OSM entities may
            belong to different roads, layers, or restrictions, so candidates must be investigated
            against the source data instead of applied automatically.
          </p>
          <ActionButton
            disabled={!hasFullNodeIndex(baseOsm.osmInfo)}
            onAction={async () => {
              const osm = baseOsm.osm;
              if (!osm) throw Error("Osm has not been loaded.");
              await Tasks.run(
                "Find duplicate nodes and ways",
                async () => {
                  const changes = await remote.generateChangeset(
                    osm.id,
                    osm.id,
                    WITHIN_DATASET_DIAGNOSTIC_OPTIONS,
                  );
                  setChangesetStats(changes);
                  return changes;
                },
                {
                  summary: (changes) =>
                    `Found ${changes.totalChanges.toLocaleString()} duplicate candidates`,
                },
              );
            }}
          >
            Find duplicate nodes and ways
          </ActionButton>
        </CardContent>
      </Card>

      {changesetStats != null && (
        <Card>
          <CardHeader>Diagnostic candidates</CardHeader>
          <CardContent className="p-0">
            <ChangesSummary />
            <Suspense fallback={<LoadingState />}>
              <Details>
                <DetailsSummary>Changes</DetailsSummary>
                <DetailsContent>
                  <ChangesFilters />
                  <ChangesList
                    setSelectedEntity={(entity) => {
                      if (!baseOsm.osm) throw Error("Osm has not been loaded.");
                      selectEntity(baseOsm.osm, entity);
                      flyToEntity(baseOsm.osm, entity);
                    }}
                  />
                  <ChangesPagination />
                </DetailsContent>
              </Details>
            </Suspense>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
