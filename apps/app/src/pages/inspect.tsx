import { InspectPanel, useFlyToOsmBounds } from "@osmix/app-components";
import {
  changesetStatsAtom,
  osmLoadingAbortControllerAtom,
  selectOsmEntityAtom,
  useLoadFromUrl,
  useOsmFile,
} from "@osmix/app-core";
import { useSetAtom } from "jotai";
import type { OsmFileType } from "osmix";

import { INSPECT_OSM_KEY } from "../settings";

/** The Inspect page's sidebar: one dataset. The shared map shows it with the routing tool. */
export function InspectSidebar() {
  const osmFile = useOsmFile(INSPECT_OSM_KEY);
  const flyToOsmBounds = useFlyToOsmBounds();
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const setChangesetStats = useSetAtom(changesetStatsAtom);
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);

  // Open `?load=<hash>` from storage, or fall back to the most recently used dataset.
  useLoadFromUrl({
    osmKey: INSPECT_OSM_KEY,
    loadFromStorage: osmFile.loadFromStorage,
    onLoaded: flyToOsmBounds,
  });

  const openOsmFile = async (file: File | string, fileType?: OsmFileType) => {
    selectEntity(null, null);
    setChangesetStats(null);

    const abortController = new AbortController();
    setLoadingState({ controller: abortController, osmKey: INSPECT_OSM_KEY });
    try {
      const osmInfo =
        typeof file === "string"
          ? await osmFile.loadFromStorage(file, abortController)
          : await osmFile.loadOsmFile(file, fileType, abortController);
      if (osmInfo) flyToOsmBounds(osmInfo);
      return osmInfo;
    } finally {
      setLoadingState(null);
    }
  };

  return <InspectPanel osmKey={INSPECT_OSM_KEY} openOsmFile={openOsmFile} />;
}
