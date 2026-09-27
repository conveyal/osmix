import { useMapPadding } from "@osmix/app-components";
import { useOsmFile, useOsmixRemote } from "@osmix/app-core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useMap } from "react-map-gl/maplibre";

import { BASE_OSM_KEY } from "../settings";
import { selectedPlanFeatureAtom } from "../state/merge-plan";

/**
 * Open an imported feature of the active plan: load its evidence and fit the map to it. Used
 * by the review rows and by clicks on the plan layer.
 */
export function useSelectPlanFeature() {
  const remote = useOsmixRemote();
  const base = useOsmFile(BASE_OSM_KEY);
  const setSelected = useSetAtom(selectedPlanFeatureAtom);
  const selected = useAtomValue(selectedPlanFeatureAtom);
  const map = useMap().current;
  const mapPadding = useMapPadding();
  const baseOsmId = base.osm?.id;
  return useCallback(
    async (featureKey: string) => {
      if (!baseOsmId || selected?.key === featureKey) return;
      const detail = await remote.getMergePlanFeature(baseOsmId, featureKey);
      setSelected(detail);
      if (map && detail.bbox) {
        map.fitBounds(detail.bbox, { padding: mapPadding(100), maxZoom: 19, maxDuration: 400 });
      }
    },
    [baseOsmId, map, mapPadding, remote, selected?.key, setSelected],
  );
}
