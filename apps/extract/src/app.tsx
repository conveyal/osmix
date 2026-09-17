import {
  Basemap,
  CustomControl,
  EntityDetailsMapControl,
  type MapInitialViewState,
  OsmFileMapControl,
  OsmixRasterSource,
  OsmixVectorOverlay,
  RouteLayer,
  RouteMapControl,
  SelectedEntityLayer,
  SidebarLog,
  useFlyToOsmBounds,
} from "@osmix/app-components";
import { selectOsmEntityAtom, useOsmFile } from "@osmix/app-core";
import { Main, MapContent, Sidebar } from "@osmix/ui";
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
      <Sidebar>
        <div className="flex-1 p-2 lg:p-4 overflow-y-auto">
          <ExtractPanel />
        </div>
        <SidebarLog />
      </Sidebar>
      <MapContent>
        <Basemap initialViewState={initialViewState}>
          {/* Content-hash IDs change per extract; keys remount the immutable react-map-gl sources. */}
          {extract.osm && (
            <OsmixRasterSource key={`extract:raster:${extract.osm.id}`} osmId={extract.osm.id} />
          )}
          {extract.osm && (
            <OsmixVectorOverlay key={`extract:overlay:${extract.osm.id}`} osm={extract.osm} />
          )}
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
