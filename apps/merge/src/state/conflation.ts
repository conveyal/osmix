import { atom } from "jotai";
import type {
  OsmConflationCandidateFilter,
  OsmConflationDecision,
  OsmConflationPage,
  OsmConflationRoutingDiagnostics,
  OsmConflationSummary,
} from "osmix";

import {
  DEFAULT_CONFLATION_FORM_STATE,
  type ConflationFormState,
} from "../lib/conflation-workflow";

export const conflationFormAtom = atom<ConflationFormState>({
  ...DEFAULT_CONFLATION_FORM_STATE,
});

export const conflationComparisonAtom = atom<GeoJSON.FeatureCollection>({
  type: "FeatureCollection",
  features: [],
});

export const conflationSummaryAtom = atom<OsmConflationSummary | null>(null);
export const conflationCandidatePageAtom = atom<OsmConflationPage | null>(null);
export const conflationCandidatePageIndexAtom = atom(0);
export const conflationCandidateFilterAtom = atom<OsmConflationCandidateFilter>({});
export const conflationDecisionsAtom = atom<OsmConflationDecision[]>([]);
export const conflationRoutingDiagnosticsAtom = atom<OsmConflationRoutingDiagnostics | null>(null);

export const resetConflationReviewAtom = atom(null, (_get, set) => {
  set(conflationSummaryAtom, null);
  set(conflationCandidatePageAtom, null);
  set(conflationCandidatePageIndexAtom, 0);
  set(conflationCandidateFilterAtom, {});
  set(conflationDecisionsAtom, []);
  set(conflationRoutingDiagnosticsAtom, null);
  set(conflationComparisonAtom, { type: "FeatureCollection", features: [] });
});
