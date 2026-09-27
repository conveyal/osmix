import {
  useOsmFile,
  changesetStatsAtom,
  selectOsmEntityAtom,
  osmLoadingAbortControllerAtom,
} from "@osmix/app-core";
import { useSetAtom } from "jotai";
import type { OsmInfo } from "osmix";
import type { OsmFileType } from "osmix";

import { useFlyToOsmBounds } from "../hooks/map.ts";
import { appOrigin } from "../lib/app-origin.ts";
import { DuplicateFixes } from "./duplicate-fixes.tsx";
import { OsmDatasetCard } from "./osm-dataset-card.tsx";
import { OsmSourceLinks } from "./osm-source-links.tsx";
import StoredOsmList from "./stored-osm-list.tsx";

/**
 * Sidebar panel for inspecting one loaded dataset: source links and stored files while the
 * slot is empty, then the dataset card (file info, save, download, clear) and the within-dataset
 * duplicate fixes (scan, review, apply, download) once a dataset is loaded.
 */
export function InspectPanel({
  osmKey,
  openOsmFile,
}: {
  /** The osm slot this panel inspects. */
  osmKey: string;
  openOsmFile: (file: File | string, fileType?: OsmFileType) => Promise<OsmInfo | null>;
}) {
  const flyToOsmBounds = useFlyToOsmBounds();
  const baseOsm = useOsmFile(osmKey);
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);
  const setChangesetStats = useSetAtom(changesetStatsAtom);

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

      <DuplicateFixes osmFile={baseOsm} />
    </div>
  );
}
