import type { UseOsmFileReturn } from "@osmix/app-core";
import type { Osm, OsmInfo } from "osmix";
import { createContext, useContext } from "react";

/** A dataset that is loaded and drawn (or hidden) on the map. */
export interface LoadedMapDataset {
  /** The slot key (`base`, `patch`); stable across loads, unique per app. */
  osmKey: string;
  /** Which map colour and line style the dataset uses. */
  role: "base" | "patch";
  /** The name shown in the legend, the inspector and search announcements. */
  label: string;
  osm: Osm;
  osmInfo: OsmInfo;
  osmFile: UseOsmFileReturn;
  /** From `datasetVisibleAtomFamily(osmKey)`. */
  visible: boolean;
}

const NO_DATASETS: LoadedMapDataset[] = [];

/**
 * The loaded datasets on the map, in slot order. `OsmixMap` provides it; the toolbar, legend,
 * search and inspector read it. Empty outside a provider.
 */
export const MapDatasetsContext = createContext<LoadedMapDataset[]>(NO_DATASETS);

/** The datasets currently loaded on the map (empty when none is). */
export function useMapDatasets(): LoadedMapDataset[] {
  return useContext(MapDatasetsContext);
}
