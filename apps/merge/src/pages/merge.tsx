import {
  Basemap,
  CustomControl,
  EntityDetailsMapControl,
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
  selectOsmEntityAtom,
  useLoadFromUrl,
  useOsmFile,
} from "@osmix/app-core";
import { Main, MapContent, Sidebar } from "@osmix/ui";
import { useSetAtom } from "jotai";
import { useMemo } from "react";

import MergeBlock from "../blocks/merge";
import { ConflationComparisonLayer } from "../components/conflation-comparison-layer";
import { BASE_OSM_KEY, PATCH_OSM_KEY } from "../settings";

export default function Merge() {
  const base = useOsmFile(BASE_OSM_KEY);
  const patch = useOsmFile(PATCH_OSM_KEY);
  const setChangesetStats = useSetAtom(changesetStatsAtom);
  const flyToOsmBounds = useFlyToOsmBounds();
  const selectEntity = useSetAtom(selectOsmEntityAtom);

  // Open `?load=<hash>` from storage, or fall back to the most recently used dataset.
  useLoadFromUrl({ loadFromStorage: base.loadFromStorage, onLoaded: flyToOsmBounds });

  const initialViewState: MapInitialViewState | undefined = useMemo(() => {
    if (!base.osmInfo?.bbox) return undefined;
    return { bounds: base.osmInfo.bbox, fitBoundsOptions: { padding: 100 } };
  }, [base.osmInfo]);

  return (
    <Main>
      <Sidebar>
        <div className="flex-1 p-2 lg:p-4 overflow-y-auto">
          <MergeBlock />
        </div>
        <SidebarLog />
      </Sidebar>
      <MapContent>
        <Basemap initialViewState={initialViewState}>
          <OsmixMapSources baseOsm={base.osm} patchOsm={patch.osm} />
          <ConflationComparisonLayer />
          <SelectedEntityLayer />
          <RouteMapControl osmFiles={[base, patch]} />
          <RouteLayer />

          <OsmFileMapControl
            files={[
              {
                osmFile: base,
                onClear: async () => {
                  selectEntity(null, null);
                  setChangesetStats(null);
                  if (patch.osm) {
                    const patchState = {
                      file: patch.file,
                      fileInfo: patch.fileInfo,
                      osm: patch.osm,
                      osmInfo: patch.osmInfo,
                      isStored: patch.isStored,
                    };
                    await patch.loadOsmFile(null);
                    base.copyStateFrom(patchState);
                  } else {
                    await base.loadOsmFile(null);
                  }
                },
              },
              {
                osmFile: patch,
                onClear: async () => {
                  selectEntity(null, null);
                  setChangesetStats(null);
                  await patch.loadOsmFile(null);
                },
              },
            ]}
          />
          {base.osm && (
            <CustomControl position="top-left">
              <EntityDetailsMapControl osm={base.osm} />
            </CustomControl>
          )}
        </Basemap>
      </MapContent>
    </Main>
  );
}
