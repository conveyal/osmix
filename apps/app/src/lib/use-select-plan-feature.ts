import { useMap, useMapPadding } from "@osmix/app-components";
import { useOsmixRemote } from "@osmix/app-core";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

import { PLAN_PAGE_SIZE } from "../components/plan-review";
import { planPageAtom, planPageIndexAtom, selectedPlanFeatureAtom } from "../state/merge-plan";
import { useBaseOsm } from "./merge-slots";

/**
 * Open an imported feature of the active plan: load its evidence, fit the map to it, and turn
 * the review to the page its row is on, so a feature picked on the map has its choices in view.
 * Used by the review rows and by clicks on the plan layer.
 */
export function useSelectPlanFeature() {
  const remote = useOsmixRemote();
  const base = useBaseOsm();
  const setSelected = useSetAtom(selectedPlanFeatureAtom);
  const selected = useAtomValue(selectedPlanFeatureAtom);
  const [pageIndex, setPageIndex] = useAtom(planPageIndexAtom);
  const setPage = useSetAtom(planPageAtom);
  const map = useMap();
  const mapPadding = useMapPadding();
  const baseOsmId = base.osm?.id;
  return useCallback(
    async (featureKey: string) => {
      if (!baseOsmId || selected?.key === featureKey) return;
      const [detail, featurePage] = await Promise.all([
        remote.getMergePlanFeature(baseOsmId, featureKey),
        remote.getMergePlanFeaturePage(baseOsmId, featureKey, PLAN_PAGE_SIZE),
      ]);
      if (featurePage != null && featurePage !== pageIndex) {
        setPage(await remote.getMergePlanPage(baseOsmId, featurePage, PLAN_PAGE_SIZE));
        setPageIndex(featurePage);
      }
      setSelected(detail);
      if (map && detail.bbox) {
        map.fitBounds(detail.bbox, { padding: mapPadding(100), maxZoom: 19, maxDuration: 400 });
      }
    },
    [
      baseOsmId,
      map,
      mapPadding,
      pageIndex,
      remote,
      selected?.key,
      setPage,
      setPageIndex,
      setSelected,
    ],
  );
}
