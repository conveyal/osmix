import { type MapInitialViewState, OsmixMap, useFlyToOsmBounds } from "@osmix/app-components";
import { useLoadFromUrl, useOsmFile } from "@osmix/app-core";
import { AppSidebar, Main, MapContent } from "@osmix/ui";
import { useMemo } from "react";

import MergeBlock from "../blocks/merge";
import { PlanMapLayer } from "../components/plan-map-layer";
import { useSelectPlanFeature } from "../lib/use-select-plan-feature";
import { BASE_OSM_KEY, PATCH_OSM_KEY } from "../settings";

export default function Merge() {
  const selectPlanFeature = useSelectPlanFeature();
  const base = useOsmFile(BASE_OSM_KEY);
  const patch = useOsmFile(PATCH_OSM_KEY);
  const flyToOsmBounds = useFlyToOsmBounds();

  // Open `?load=<hash>` from storage, or fall back to the most recently used dataset.
  useLoadFromUrl({ loadFromStorage: base.loadFromStorage, onLoaded: flyToOsmBounds });

  const initialViewState: MapInitialViewState | undefined = useMemo(() => {
    if (!base.osmInfo?.bbox) return undefined;
    return { bounds: base.osmInfo.bbox, fitBoundsOptions: { padding: 100 } };
  }, [base.osmInfo]);

  return (
    <Main>
      <AppSidebar>
        <MergeBlock />
      </AppSidebar>
      <MapContent>
        <OsmixMap
          datasets={[
            { osmFile: base, role: "base" },
            { osmFile: patch, role: "patch" },
          ]}
          initialViewState={initialViewState}
        >
          <PlanMapLayer onSelect={selectPlanFeature} />
        </OsmixMap>
      </MapContent>
    </Main>
  );
}
