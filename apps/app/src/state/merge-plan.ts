import type { SavedMergeDecisions } from "@osmix/app-core";
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
  PlanDecision,
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
/**
 * Row choices not yet sent to the planner: the decisions the plan will have once they are,
 * and the proposals chosen on rows. Replanning takes a while on a large import, so choices
 * collect here and replan once.
 */
export const planDraftAtom = atom<{ decisions: PlanDecision[]; chosen: string[] } | null>(null);
/**
 * The draft's choices that differ from the plan's decisions, by proposal ID: the action, or
 * null for "decide later". Proposals the draft leaves out because of a choice count too.
 */
export const planPendingChoicesAtom = atom((get) => {
  const draft = get(planDraftAtom);
  const pending = new Map<string, PlanDecision["action"] | null>();
  if (!draft) return pending;
  const committed = new Map(
    (get(planOverviewAtom)?.decisions ?? []).map(({ proposalId, action }) => [proposalId, action]),
  );
  const drafted = new Map(draft.decisions.map(({ proposalId, action }) => [proposalId, action]));
  for (const id of new Set([...committed.keys(), ...drafted.keys()])) {
    const action = drafted.get(id) ?? null;
    if (action !== (committed.get(id) ?? null)) pending.set(id, action);
  }
  return pending;
});
/** Decisions saved from an earlier review of the same files, offered back until answered. */
export const savedChoicesOfferAtom = atom<SavedMergeDecisions | null>(null);
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
  set(planDraftAtom, null);
  set(savedChoicesOfferAtom, null);
});
