import { type MapInitialViewState, OsmixMap, useFlyToOsmBounds } from "@osmix/app-components";
import { useOsmFile } from "@osmix/app-core";
import { AppSidebar, Main, MapContent } from "@osmix/ui";
import { useEffect, useMemo } from "react";

import ExtractMapLayers from "./components/extract-map-layers";
import { ExtractPanel } from "./extract-panel";
import { DEFAULT_EXTRACT_BBOX } from "./lib/extract-bbox";
import { OSM_KEY } from "./settings";

/** Pick a bbox and a source PBF, extract, then save or download the result. */
export function ExtractApp() {
  const extract = useOsmFile(OSM_KEY);
  const flyToOsmBounds = useFlyToOsmBounds();

  // OsmixMap seeds the camera at mount only; fit it to each new extract result.
  useEffect(() => {
    if (extract.osmInfo) flyToOsmBounds(extract.osmInfo);
  }, [extract.osmInfo, flyToOsmBounds]);

  const initialViewState: MapInitialViewState | undefined = useMemo(() => {
    if (extract.osmInfo?.bbox) {
      return { bounds: extract.osmInfo.bbox, fitBoundsOptions: { padding: 100 } };
    }
    return { bounds: DEFAULT_EXTRACT_BBOX, fitBoundsOptions: { padding: 80 } };
  }, [extract.osmInfo]);

  return (
    <Main>
      <AppSidebar>
        <ExtractPanel />
      </AppSidebar>
      <MapContent>
        <OsmixMap
          datasets={
            extract.osm ? [{ osmFile: extract, role: "base", label: "Extract result" }] : []
          }
          initialViewState={initialViewState}
        >
          <ExtractMapLayers />
        </OsmixMap>
      </MapContent>
    </Main>
  );
}
