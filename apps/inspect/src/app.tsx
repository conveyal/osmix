import {
  Basemap,
  CustomControl,
  EntityDetailsMapControl,
  InspectPanel,
  type MapInitialViewState,
  OsmFileMapControl,
  OsmixMapSources,
  RouteLayer,
  RouteMapControl,
  SelectedEntityLayer,
  SidebarLog,
  useFlyToOsmBounds,
} from "@osmix/app-components";
import {
  changesetStatsAtom,
  osmLoadingAbortControllerAtom,
  selectOsmEntityAtom,
  useLoadFromUrl,
  useOsmFile,
} from "@osmix/app-core";
import { Main, MapContent, Sidebar } from "@osmix/ui";
import { useSetAtom } from "jotai";
import type { OsmFileType } from "osmix";
import { useMemo } from "react";

import { OSM_KEY } from "./settings";

/** One dataset, one sidebar panel, one map. */
export function InspectApp() {
  const osmFile = useOsmFile(OSM_KEY);
  const flyToOsmBounds = useFlyToOsmBounds();
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const setChangesetStats = useSetAtom(changesetStatsAtom);
  const setLoadingState = useSetAtom(osmLoadingAbortControllerAtom);

  // Open `?load=<hash>` from storage, or fall back to the most recently used dataset.
  useLoadFromUrl({ loadFromStorage: osmFile.loadFromStorage, onLoaded: flyToOsmBounds });

  const openOsmFile = async (file: File | string, fileType?: OsmFileType) => {
    selectEntity(null, null);
    setChangesetStats(null);

    const abortController = new AbortController();
    setLoadingState({ controller: abortController, osmKey: OSM_KEY });
    try {
      const osmInfo =
        typeof file === "string"
          ? await osmFile.loadFromStorage(file, abortController.signal)
          : await osmFile.loadOsmFile(file, fileType, abortController.signal);
      if (osmInfo) flyToOsmBounds(osmInfo);
      return osmInfo;
    } finally {
      setLoadingState(null);
    }
  };

  const clearOsmFile = async () => {
    selectEntity(null, null);
    setChangesetStats(null);
    await osmFile.loadOsmFile(null);
  };

  const initialViewState: MapInitialViewState | undefined = useMemo(() => {
    if (!osmFile.osmInfo?.bbox) return undefined;
    return { bounds: osmFile.osmInfo.bbox, fitBoundsOptions: { padding: 100 } };
  }, [osmFile.osmInfo]);

  return (
    <Main>
      <Sidebar>
        <div className="flex-1 p-2 lg:p-4 overflow-y-auto">
          <InspectPanel osmKey={OSM_KEY} openOsmFile={openOsmFile} />
        </div>
        <SidebarLog />
      </Sidebar>
      <MapContent>
        <Basemap initialViewState={initialViewState}>
          <OsmixMapSources baseOsm={osmFile.osm} />
          <SelectedEntityLayer />
          <RouteMapControl osmFiles={[osmFile]} />
          <RouteLayer />
          <OsmFileMapControl files={[{ osmFile, onClear: clearOsmFile }]} />
          {osmFile.osm && (
            <CustomControl position="top-left">
              <EntityDetailsMapControl osm={osmFile.osm} />
            </CustomControl>
          )}
        </Basemap>
      </MapContent>
    </Main>
  );
}
