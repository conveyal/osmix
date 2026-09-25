import { basemapPresetAtom, mapBoundsAtom, mapCenterAtom, zoomAtom } from "@osmix/app-core";
import { useAtomValue, useSetAtom } from "jotai";
import type { MapLibreEvent } from "maplibre-gl";
import { useEffect, useEffectEvent } from "react";
import {
  Map as MaplibreMap,
  type MapProps,
  ScaleControl,
  type ViewStateChangeEvent,
} from "react-map-gl/maplibre";

import { BASE_MAP_STYLES } from "../constants.ts";
import { useMap } from "../hooks/map.ts";
import { applyBasemapPreset } from "../lib/basemap-layers.ts";

const MAP_CENTER = [-120.5, 46.6] as const; // Yakima, WA
const MAP_ZOOM = 10;

const DEFAULT_INITIAL_VIEW_STATE = {
  longitude: MAP_CENTER[0],
  latitude: MAP_CENTER[1],
  zoom: MAP_ZOOM,
};

export type MapInitialViewState = MapProps["initialViewState"];

/**
 * The MapLibre map with the persisted basemap preset applied. It publishes the camera to the
 * map atoms and mounts nothing else: data layers and the overlay come in as `children`.
 *
 * A preset style switch calls `setStyle` with diffing; MapLibre then removes every Osmix source
 * and layer and the react-map-gl `Source`/`Layer` children re-add themselves on the next
 * `styledata`. The raster and vector protocols are global and survive the switch.
 */
export default function Basemap({
  children,
  initialViewState,
}: {
  children?: React.ReactNode;
  initialViewState?: MapInitialViewState;
}) {
  const preset = useAtomValue(basemapPresetAtom);
  const mapRef = useMap();
  const setCenter = useSetAtom(mapCenterAtom);
  const setBounds = useSetAtom(mapBoundsAtom);
  const setZoom = useSetAtom(zoomAtom);

  const onViewStateChange = useEffectEvent((e: ViewStateChangeEvent | MapLibreEvent) => {
    setBounds(e.target.getBounds());
    setCenter(e.target.getCenter());
    setZoom(e.target.getZoom());
  });

  // Applied when a style finishes loading (the first one and every preset style switch).
  const onStyleLoad = useEffectEvent((e: MapLibreEvent) => {
    applyBasemapPreset(e.target, preset);
  });

  const onLoad = useEffectEvent((e: MapLibreEvent) => {
    onStyleLoad(e);
    onViewStateChange(e);
    // The compact attribution starts expanded and MapLibre only collapses it on `drag`, which
    // would leave its text under the bottom-left legend until the first pan. Collapse it once
    // the map is up; the summary button still toggles it, and `resize` leaves it alone.
    e.target
      .getContainer()
      .querySelector(".maplibregl-ctrl-attrib")
      ?.classList.remove("maplibregl-compact-show");
  });

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const handler = (e: MapLibreEvent) => onStyleLoad(e);
    map.on("style.load", handler);
    return () => {
      map.off("style.load", handler);
    };
  }, [mapRef]);

  // Labels and roads toggles change the preset without a style switch.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (map) applyBasemapPreset(map, preset);
  }, [mapRef, preset]);

  return (
    <MaplibreMap
      reuseMaps={true}
      mapStyle={BASE_MAP_STYLES[preset.style]}
      initialViewState={{ ...DEFAULT_INITIAL_VIEW_STATE, ...initialViewState }}
      // Compact, so the attribution never expands under the bottom-left legend.
      attributionControl={{ compact: true }}
      onLoad={onLoad}
      onMove={onViewStateChange}
      onZoom={onViewStateChange}
    >
      {/* MapLibre stacks bottom controls upward, so the scale sits above the attribution. */}
      <ScaleControl position="bottom-right" unit="imperial" />

      {children}
    </MaplibreMap>
  );
}
