import type { BasemapPreset } from "@osmix/app-core";
import type { MapInstance } from "react-map-gl/maplibre";

import { APPID } from "../constants.ts";

/** What a basemap layer draws, as far as the basemap preset cares. */
export type BasemapLayerKind = "road" | "roadLabel" | "label" | "other";

const ROAD_PREFIXES = ["road", "bridge", "tunnel", "rail", "aeroway"] as const;
const ROAD_LABEL_PREFIXES = ["roadname", "housenumber"] as const;

function startsWithAny(id: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => id.startsWith(prefix));
}

/**
 * Classify a Carto basemap layer by its id and type. Roads are the `line` layers for roads,
 * bridges, tunnels, rail and aeroways; road labels are the road-name and house-number `symbol`
 * layers; every other `symbol` layer is a place, water or POI label. Everything else (fills,
 * waterways, boundaries, buildings) and every Osmix layer is `other`, which the preset never
 * touches.
 */
export function classifyBasemapLayer({ id, type }: { id: string; type: string }): BasemapLayerKind {
  if (id.startsWith(APPID)) return "other";
  if (type === "line") return startsWithAny(id, ROAD_PREFIXES) ? "road" : "other";
  if (type === "symbol") return startsWithAny(id, ROAD_LABEL_PREFIXES) ? "roadLabel" : "label";
  return "other";
}

/** The layout `visibility` a layer of `kind` gets under `preset`. */
export function basemapLayerVisibility(
  kind: BasemapLayerKind,
  preset: Pick<BasemapPreset, "labels" | "roads">,
): "visible" | "none" {
  switch (kind) {
    case "road":
      return preset.roads ? "visible" : "none";
    case "roadLabel":
      return preset.roads && preset.labels ? "visible" : "none";
    case "label":
      return preset.labels ? "visible" : "none";
    default:
      return "visible";
  }
}

/**
 * Apply `preset` to the loaded style: set each basemap layer's visibility, skipping Osmix
 * layers and layers that already match. A no-op until the style has layers, so call it again
 * on `style.load` and `load`.
 */
export function applyBasemapPreset(map: MapInstance, preset: BasemapPreset): void {
  const layers = map.getStyle()?.layers;
  if (!layers) return;
  for (const layer of layers) {
    if (layer.id.startsWith(APPID)) continue;
    const desired = basemapLayerVisibility(classifyBasemapLayer(layer), preset);
    const current = map.getLayoutProperty(layer.id, "visibility") ?? "visible";
    if (current !== desired) map.setLayoutProperty(layer.id, "visibility", desired);
  }
}
