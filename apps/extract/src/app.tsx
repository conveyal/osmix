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
import { searchControlIsOpenAtom, selectOsmEntityAtom, useOsmFile } from "@osmix/app-core";
import { AppSidebar, Main, MapContent } from "@osmix/ui";
import { useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";

import ExtractMapLayers from "./components/extract-map-layers";
import { ExtractPanel } from "./extract-panel";
import { DEFAULT_EXTRACT_BBOX } from "./lib/extract-bbox";
import { OSM_KEY } from "./settings";

/** Pick a bbox and a source PBF, extract, then save or download the result. */
export function ExtractApp() {
  const extract = useOsmFile(OSM_KEY);
  const flyToOsmBounds = useFlyToOsmBounds();
  const selectEntity = useSetAtom(selectOsmEntityAtom);
  const setSearchControlIsOpen = useSetAtom(searchControlIsOpenAtom);

  // Place search is how most extracts start, so show the shared map search by default.
  useEffect(() => {
    setSearchControlIsOpen(true);
  }, [setSearchControlIsOpen]);

  useEffect(() => {
    if (extract.osmInfo) flyToOsmBounds(extract.osmInfo);
  }, [extract.osmInfo, flyToOsmBounds]);

  const initialViewState: MapInitialViewState | undefined = useMemo(() => {
    if (extract.osmInfo?.bbox) {
      return { bounds: extract.osmInfo.bbox, fitBoundsOptions: { padding: 100 } };
    }
    return { bounds: DEFAULT_EXTRACT_BBOX, fitBoundsOptions: { padding: 80 } };
  }, [extract.osmInfo]);

  const clearExtract = async () => {
    selectEntity(null, null);
    await extract.loadOsmFile(null);
  };

  return (
    <Main>
      <AppSidebar footer={<SidebarLog />}>
        <ExtractPanel />
      </AppSidebar>
      <MapContent>
        <Basemap initialViewState={initialViewState}>
          <OsmixMapSources baseOsm={extract.osm} />
          <ExtractMapLayers />
          <SelectedEntityLayer />
          <RouteMapControl osmFiles={[extract]} />
          <RouteLayer />
          <OsmFileMapControl files={[{ osmFile: extract, onClear: clearExtract }]} />
          {extract.osm && (
            <CustomControl position="top-left">
              <EntityDetailsMapControl osm={extract.osm} />
            </CustomControl>
          )}
        </Basemap>
      </MapContent>
    </Main>
  );
}
