import { type BasemapStyleId, basemapPresetAtom, mapModeAtom } from "@osmix/app-core";
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuIconTrigger,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from "@osmix/ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  MapIcon,
  MaximizeIcon,
  MinusIcon,
  NavigationIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import type { GeoBbox2D } from "osmix";
import { useMemo } from "react";

import { BASE_MAP_STYLES } from "../constants.ts";
import { useMap, useMapPadding } from "../hooks/map.ts";
import { enterRoutingModeAtom, exitRoutingModeAtom } from "../state/routing.ts";
import { useMapDatasets } from "./map-datasets.tsx";
import { MapPanel, useMapOverlayAction } from "./map-overlay.tsx";
import { mapSearchToggleId } from "./map-search.tsx";

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

/**
 * The top-left column of map tools: zoom, fit to all loaded data, the search toggle, the
 * basemap menu and, with `routing`, the routing tool. The search panel's open state belongs to
 * the parent (`OsmixMap`), which renders `MapSearch` beside this toolbar: `searchOpen` and
 * `searchPanelId` name it in `aria-expanded`/`aria-controls`, and `onToggleSearch` flips it.
 * The toolbar registers the routing tool with the overlay's Esc stack while it is active.
 */
export function MapToolbar({
  routing = false,
  searchOpen,
  onToggleSearch,
  searchPanelId,
}: {
  /** Show the "Route between two points" tool (Inspect only). */
  routing?: boolean;
  searchOpen: boolean;
  onToggleSearch: () => void;
  /** The `MapSearch` panel's DOM id. */
  searchPanelId: string;
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
    <MapPanel
      width="auto"
      data-slot="map-toolbar"
      role="group"
      aria-label="Map tools"
      className="shrink-0"
    >
      <div className="flex flex-col">
        <IconButton
          size="icon"
          tooltipSide="right"
          label="Zoom in"
          icon={<PlusIcon aria-hidden="true" />}
          onClick={() => map?.zoomIn()}
        />
        <IconButton
          size="icon"
          tooltipSide="right"
          label="Zoom out"
          icon={<MinusIcon aria-hidden="true" />}
          onClick={() => map?.zoomOut()}
        />
        <IconButton
          size="icon"
          tooltipSide="right"
          label="Fit map to all data"
          icon={<MaximizeIcon aria-hidden="true" />}
          disabled={!dataBbox}
          onClick={() => {
            if (dataBbox) map?.fitBounds(dataBbox, { padding: mapPadding(100), maxDuration: 200 });
          }}
        />
      </div>
      <div className="flex flex-col border-t">
        <IconButton
          size="icon"
          tooltipSide="right"
          id={mapSearchToggleId(searchPanelId)}
          label="Open map search"
          aria-expanded={searchOpen}
          aria-controls={searchPanelId}
          icon={<SearchIcon aria-hidden="true" />}
          onClick={onToggleSearch}
        />
        <Menu>
          <MenuIconTrigger
            tooltipSide="right"
            label="Basemap"
            icon={<MapIcon aria-hidden="true" />}
          />
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
        {routing ? (
          <IconButton
            size="icon"
            tooltipSide="right"
            label="Route between two points"
            aria-pressed={routingActive}
            disabled={!canRoute}
            icon={<NavigationIcon aria-hidden="true" />}
            onClick={() => (routingActive ? exitRouting() : enterRouting())}
          />
        ) : null}
      </div>
    </MapPanel>
  );
}
