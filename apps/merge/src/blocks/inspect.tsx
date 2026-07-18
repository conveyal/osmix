import { useAtom, useSetAtom } from "jotai";
import { MergeIcon } from "lucide-react";
import type { OsmInfo } from "osmix";
import type { OsmFileType } from "osmix";
import { Suspense, useMemo } from "react";

import ActionButton from "../components/action-button";
import { Details, DetailsContent, DetailsSummary } from "../components/details";
import ExtractList from "../components/extract-list";
import { FullIndexRequired, hasFullNodeIndex } from "../components/full-index-required";
import ChangesSummary, {
  ChangesFilters,
  ChangesList,
  ChangesPagination,
} from "../components/osm-changes-summary";
import { EmptyState, LoadingState } from "../components/section";
import StoredOsmList from "../components/stored-osm-list";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { useFlyToEntity, useFlyToOsmBounds } from "../hooks/map";
import { useOsmFile } from "../hooks/osm";
import { BASE_OSM_KEY } from "../settings";
import { changesetStatsAtom } from "../state/changes";
import { Log } from "../state/log";
import { selectOsmEntityAtom } from "../state/osm";
import { osmLoadingAbortControllerAtom } from "../state/status";
import { osmWorker } from "../state/worker";

export default function InspectBlock({
  openOsmFile,
}: {
  openOsmFile: (file: File | string, fileType?: OsmFileType) => Promise<OsmInfo | null>;
}) {
  const flyToEntity = useFlyToEntity();
  const flyToOsmBounds = useFlyToOsmBounds();
  const baseOsm = useOsmFile(BASE_OSM_KEY);
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);
  const [changesetStats, setChangesetStats] = useAtom(changesetStatsAtom);

  const applyChanges = async () => {
    if (!baseOsm.osm) throw Error("Osm has not been loaded.");
    const task = Log.startTask("Applying changes to OSM...");
    await osmWorker.applyChangesAndReplace(baseOsm.osm.id);
    task.update("Refreshing OSM index...");
    const newOsm = await osmWorker.get(baseOsm.osm.id);
    baseOsm.setOsm(newOsm);
    setChangesetStats(null);
    task.end("Changes applied!");
  };

  const hasZeroChanges = useMemo(() => {
    return changesetStats == null || changesetStats.totalChanges === 0;
  }, [changesetStats]);

  if (!baseOsm.osm || !baseOsm.osmInfo || !baseOsm.fileInfo) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState className="p-0">
          Select an OSM file to inspect, or extract a region on the Extract tab.
        </EmptyState>
        <ExtractList
          openOsmPbfUrl={async (url) => {
            const osmInfo = await baseOsm.loadOsmPbfUrl(url);
            if (osmInfo) flyToOsmBounds(osmInfo);
            return osmInfo;
          }}
        />
        <StoredOsmList
          osmKey={BASE_OSM_KEY}
          loadFailure={baseOsm.loadFailure}
          onDismissLoadFailure={baseOsm.clearLoadFailure}
          onReloadView={baseOsm.reloadWithViewProfile}
          openOsmPbfUrl={async (url) => {
            const abortController = new AbortController();
            setLoadingState({ controller: abortController, osmKey: BASE_OSM_KEY });
            try {
              const osmInfo = await baseOsm.loadOsmPbfUrl(url, abortController.signal);
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
              osmKey: BASE_OSM_KEY,
            });
            try {
              const osmInfo =
                typeof file === "string"
                  ? await baseOsm.loadFromStorage(file, abortController.signal)
                  : await baseOsm.loadOsmFile(file, undefined, abortController.signal);
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

  return (
    <div className="flex flex-1 flex-col gap-4">
      <FullIndexRequired operation="Duplicate detection" osmFile={baseOsm} />
      <ActionButton
        disabled={!hasFullNodeIndex(baseOsm.osmInfo)}
        onAction={async () => {
          if (!baseOsm.osm) throw Error("Osm has not been loaded.");
          const changes = await osmWorker.generateChangeset(baseOsm.osm.id, baseOsm.osm.id, {
            deduplicateNodes: true,
            deduplicateWays: true,
          });
          setChangesetStats(changes);
        }}
      >
        Find duplicate nodes and ways
      </ActionButton>

      {changesetStats != null && (
        <>
          <Card>
            <CardHeader>Changeset</CardHeader>
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

          {!hasZeroChanges && (
            <ActionButton className="w-full" onAction={applyChanges} icon={<MergeIcon />}>
              Apply changes
            </ActionButton>
          )}
        </>
      )}
    </div>
  );
}
