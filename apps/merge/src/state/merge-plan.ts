import { atom } from "jotai";
import type {
  MergePlanFeatureDetail,
  MergePlanFilter,
  MergePlanLayer,
  MergePlanOverview,
  MergePlanPage,
  PatchIdMode,
} from "osmix";

/** "Merge points at identical coordinates automatically". On by default; kept for the session. */
export const mergeIdenticalPointsAtom = atom(true);

/** How patch IDs are read: the OSM convention, or every feature as new. */
export const patchIdModeAtom = atom<PatchIdMode>("osm");

export const planOverviewAtom = atom<MergePlanOverview | null>(null);
export const planFilterAtom = atom<MergePlanFilter>({});
export const planPageAtom = atom<MergePlanPage | null>(null);
export const planPageIndexAtom = atom(0);
export const planLayerAtom = atom<MergePlanLayer | null>(null);
/** The feature whose evidence is open, highlighted on the map. */
export const selectedPlanFeatureAtom = atom<MergePlanFeatureDetail | null>(null);

/** Forget the review; the settings above stay. */
export const resetMergePlanAtom = atom(null, (_get, set) => {
  set(planOverviewAtom, null);
  set(planFilterAtom, {});
  set(planPageAtom, null);
  set(planPageIndexAtom, 0);
  set(planLayerAtom, null);
  set(selectedPlanFeatureAtom, null);
});
