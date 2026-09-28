import { pagePath } from "@osmix/app-components";
import { type OsmFileSnapshot, Tasks, useOsmFile } from "@osmix/app-core";
import { useSetAtom } from "jotai";
import { useLocation } from "wouter";

import { datasetAsExtractSourceAtom } from "../pages/extract/state/extract";
import { EXTRACT_OSM_KEY, EXTRACT_SOURCE_OSM_KEY, INSPECT_OSM_KEY } from "../settings";
import { useBaseOsm, usePatchOsm } from "./merge-slots";

/** Where a dataset can be opened: Merge's inputs, Inspect, or Extract's source. */
export type OpenInTarget = "base" | "patch" | "inspect" | "extract";

export const OPEN_IN_LABELS: Record<OpenInTarget, string> = {
  base: "Merge as base",
  patch: "Merge as patch",
  inspect: "Inspect",
  extract: "Extract from it",
};

/**
 * Open a dataset on another page without reloading it: copy it into that page's slot, replacing
 * what the slot held, then go there. Merge refuses a file its other input already holds; the
 * refusal is reported and nothing changes.
 */
export function useOpenIn() {
  const base = useBaseOsm();
  const patch = usePatchOsm();
  const inspect = useOsmFile(INSPECT_OSM_KEY);
  const extract = useOsmFile(EXTRACT_OSM_KEY);
  const extractSource = useOsmFile(EXTRACT_SOURCE_OSM_KEY);
  const setExtractSourceDataset = useSetAtom(datasetAsExtractSourceAtom);
  const [, navigate] = useLocation();

  return async (target: OpenInTarget, dataset: OsmFileSnapshot) => {
    const slot = { base, patch, inspect, extract: extractSource }[target];
    try {
      await slot.copyStateFrom(dataset);
    } catch (error) {
      Tasks.message(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    if (target === "extract") {
      // Extract shows its form again, for a new extract from this dataset.
      await extract.loadOsmFile(null);
      setExtractSourceDataset(dataset.osmInfo?.bbox ?? null);
    }
    navigate(pagePath(target === "base" || target === "patch" ? "merge" : target));
  };
}
