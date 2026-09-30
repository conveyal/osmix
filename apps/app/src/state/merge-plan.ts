import { atom } from "jotai";
import type { GeoBbox2D } from "osmix";
import type {
  MergePlanAutomation,
  MergePlanBulkPreview,
  MergePlanFeatureDetail,
  MergePlanFilter,
  MergePlanOverview,
  MergePlanPage,
  PatchIdMode,
} from "osmix";

import {
  type ConflationFormState,
  DEFAULT_CONFLATION_FORM_STATE,
} from "../lib/conflation-workflow";

/** The matching settings form; matching is off until enabled. */
export const conflationFormAtom = atom<ConflationFormState>({
  ...DEFAULT_CONFLATION_FORM_STATE,
});

/** "Merge points at identical coordinates automatically". On by default; kept for the session. */
export const mergeIdenticalPointsAtom = atom(true);

/** How much the planner decides without you; see `AUTOMATION_OPTIONS`. Kept for the session. */
export const automationLevelAtom = atom<MergePlanAutomation>("recommended");

/** How patch IDs are read: the OSM convention, or every feature as new. */
export const patchIdModeAtom = atom<PatchIdMode>("osm");

export const planOverviewAtom = atom<MergePlanOverview | null>(null);
export const planFilterAtom = atom<MergePlanFilter>({});
export const planPageAtom = atom<MergePlanPage | null>(null);
export const planPageIndexAtom = atom(0);
/** What each bulk choice would do to the features the filter shows. */
export const planBulkPreviewAtom = atom<MergePlanBulkPreview | null>(null);
/**
 * The plan drawn on the map from worker tiles. `revision` changes whenever outcomes may have, so
 * the map fetches fresh tiles; `bounds` limits tile requests to the patch.
 */
let planRevision = 0;
/** A revision no earlier plan map used, so tile URLs are never reused across plans. */
export const nextPlanRevision = () => ++planRevision;

export const planMapAtom = atom<{
  baseOsmId: string;
  revision: number;
  bounds?: GeoBbox2D;
} | null>(null);
/** The feature whose evidence is open, highlighted on the map. */
export const selectedPlanFeatureAtom = atom<MergePlanFeatureDetail | null>(null);

/** Forget the review; the settings above stay. */
export const resetMergePlanAtom = atom(null, (_get, set) => {
  set(planOverviewAtom, null);
  set(planFilterAtom, {});
  set(planPageAtom, null);
  set(planPageIndexAtom, 0);
  set(planBulkPreviewAtom, null);
  set(planMapAtom, null);
  set(selectedPlanFeatureAtom, null);
});
