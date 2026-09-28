import {
  type BasemapStyleId,
  basemapPresetAtom,
  mapCenterAtom,
  mapModeAtom,
  zoomAtom,
} from "@osmix/app-core";
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuIconTrigger,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  NavSeparator,
} from "@osmix/ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { MapIcon, MaximizeIcon, MinusIcon, NavigationIcon, PlusIcon } from "lucide-react";
import type { GeoBbox2D } from "osmix";
import { useMemo } from "react";

import { BASE_MAP_STYLES } from "../constants.ts";
import { useMap, useMapPadding } from "../hooks/map.ts";
import { enterRoutingModeAtom, exitRoutingModeAtom } from "../state/routing.ts";
import { useMapDatasets } from "./map-datasets.tsx";
import { useMapOverlayAction } from "./map-overlay.tsx";
import { MapSearch } from "./map-search.tsx";

const BASEMAP_STYLE_LABELS: Record<BasemapStyleId, string> = {
  "carto-positron": "Positron",
  "carto-voyager": "Voyager",
  "carto-dark": "Dark",
};

const BASEMAP_STYLE_IDS = Object.keys(BASEMAP_STYLE_LABELS) as BasemapStyleId[];

function isBasemapStyleId(value: unknown): value is BasemapStyleId {
  return typeof value === "string" && value in BASE_MAP_STYLES;
}

/** The smallest bbox that holds every given bbox, or `null` when there is none. */
export function unionBboxes(bboxes: Iterable<GeoBbox2D | null | undefined>): GeoBbox2D | null {
  let union: GeoBbox2D | null = null;
  for (const bbox of bboxes) {
    if (!bbox) continue;
    union = union
      ? [
          Math.min(union[0], bbox[0]),
          Math.min(union[1], bbox[1]),
          Math.max(union[2], bbox[2]),
          Math.max(union[3], bbox[3]),
        ]
      : [...bbox];
  }
  return union;
}

/** The map center as "lon, lat" to four decimals (about 10 m), selectable for copying. */
function MapCenterReadout() {
  const center = useAtomValue(mapCenterAtom);
  return (
    <span
      data-slot="map-center"
      title="Map center (longitude, latitude)"
      className="px-2 font-mono whitespace-nowrap tabular-nums select-all"
    >
      {center ? `${center.lng.toFixed(4)}, ${center.lat.toFixed(4)}` : "--, --"}
    </span>
  );
}

/** The zoom level to two decimals, between the zoom buttons. */
function MapZoomReadout() {
  const zoom = useAtomValue(zoomAtom);
  return (
    <span
      data-slot="map-zoom"
      title="Zoom level"
      className="font-mono whitespace-nowrap tabular-nums"
    >
      z{zoom === null ? "--" : zoom.toFixed(2)}
    </span>
  );
}

/**
 * The map tools, in the nav (`OsmixMap` portals them into its map-tools slot): the map center,
 * zoom out, the zoom level, zoom in, fit to all loaded data, then the search popover, the
 * basemap menu and the routing tool, which is disabled without `routing` so the toolbar keeps
 * its shape across pages.
 * The toolbar registers the routing tool with the overlay's Esc stack while it is active.
 */
export function MapToolbar({
  routing = false,
}: {
  /** Enable the "Route between two points" tool (Inspect only). */
  routing?: boolean;
}) {
  const map = useMap();
  const mapPadding = useMapPadding();
  const datasets = useMapDatasets();
  const [preset, setPreset] = useAtom(basemapPresetAtom);
  const mode = useAtomValue(mapModeAtom);
  const enterRouting = useSetAtom(enterRoutingModeAtom);
  const exitRouting = useSetAtom(exitRoutingModeAtom);
  const routingActive = routing && mode === "route";
  useMapOverlayAction("route", routingActive, exitRouting);

  const dataBbox = useMemo(
    () => unionBboxes(datasets.map((dataset) => dataset.osmInfo.bbox)),
    [datasets],
  );
  // Routing works on a visible dataset; with every dataset hidden there is nothing to click.
  const canRoute = datasets.some((dataset) => dataset.visible);

  return (
    <div
      data-slot="map-toolbar"
      role="group"
      aria-label="Map tools"
      className="flex h-full items-center gap-1"
    >
      <MapCenterReadout />
      <NavSeparator />
      <IconButton
        label="Zoom out"
        icon={<MinusIcon aria-hidden="true" />}
        onClick={() => map?.zoomOut()}
      />
      <MapZoomReadout />
      <IconButton
        label="Zoom in"
        icon={<PlusIcon aria-hidden="true" />}
        onClick={() => map?.zoomIn()}
      />
      <IconButton
        label="Fit map to all data"
        icon={<MaximizeIcon aria-hidden="true" />}
        disabled={!dataBbox}
        onClick={() => {
          if (dataBbox) map?.fitBounds(dataBbox, { padding: mapPadding(100), maxDuration: 200 });
        }}
      />
      <NavSeparator />
      <MapSearch />
      <Menu>
        <MenuIconTrigger size="icon-sm" label="Basemap" icon={<MapIcon aria-hidden="true" />} />
        <MenuContent>
          <MenuRadioGroup
            value={preset.style}
            onValueChange={(value) => {
              if (isBasemapStyleId(value)) setPreset((prev) => ({ ...prev, style: value }));
            }}
          >
            {BASEMAP_STYLE_IDS.map((style) => (
              <MenuRadioItem key={style} value={style}>
                {BASEMAP_STYLE_LABELS[style]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuCheckboxItem
            checked={preset.labels}
            onCheckedChange={(labels) => setPreset((prev) => ({ ...prev, labels }))}
          >
            Labels
          </MenuCheckboxItem>
          <MenuCheckboxItem
            checked={preset.roads}
            onCheckedChange={(roads) => setPreset((prev) => ({ ...prev, roads }))}
          >
            Roads
          </MenuCheckboxItem>
        </MenuContent>
      </Menu>
      <IconButton
        label={routing ? "Route between two points" : "Route between two points (in Inspect)"}
        aria-pressed={routingActive}
        disabled={!routing || !canRoute}
        icon={<NavigationIcon aria-hidden="true" />}
        onClick={() => (routingActive ? exitRouting() : enterRouting())}
      />
    </div>
  );
}
