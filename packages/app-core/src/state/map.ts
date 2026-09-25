import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage } from "jotai/utils";
import type { LngLat, LngLatBounds } from "maplibre-gl";

export const mapBoundsAtom = atom<LngLatBounds | null>(null);
export const zoomAtom = atom<number | null>(null);
export const mapCenterAtom = atom<LngLat | null>(null);

/** The basemap styles the apps offer; each id names a URL in `BASE_MAP_STYLES`. */
export type BasemapStyleId = "carto-positron" | "carto-voyager" | "carto-dark";

/** The basemap look: a style plus whether its labels and roads are drawn. */
export interface BasemapPreset {
  style: BasemapStyleId;
  labels: boolean;
  roads: boolean;
}

export const DEFAULT_BASEMAP_PRESET: BasemapPreset = {
  style: "carto-positron",
  labels: true,
  roads: false,
};

/**
 * The persisted basemap preset. `getOnInit` reads storage before the first render so the map
 * mounts with the stored style: without it the map would load Positron first and then
 * `setStyle` to the stored one, which removes and re-adds every Osmix source and layer.
 */
export const basemapPresetAtom = atomWithStorage<BasemapPreset>(
  "@osmix:map:basemap",
  DEFAULT_BASEMAP_PRESET,
  undefined,
  { getOnInit: true },
);

/** What a map click does: select a feature, or place a routing point. */
export const mapModeAtom = atom<"select" | "route">("select");

/**
 * Whether a loaded dataset is drawn on the map. Keyed by the slot's `osmKey`, not `osm.id`:
 * Merge can load one file into both slots and the two would share a content-hash id.
 */
export const datasetVisibleAtomFamily = atomFamily((_osmKey: string) => atom(true));
