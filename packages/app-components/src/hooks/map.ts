import { type MapInset, mapInsetAtom, selectOsmEntityAtom } from "@osmix/app-core";
import { useSetAtom, useStore } from "jotai";
import type { Osm, OsmInfo } from "osmix";
import type { OsmEntity } from "osmix";
import { isNode, isRelation, isWay } from "osmix";
import { useEffectEvent } from "react";
import { useMap as useMapCollection } from "react-map-gl/maplibre";

export function useMap() {
  const mapCollection = useMapCollection();

  return mapCollection.default ?? mapCollection.current ?? null;
}

/** Per-edge map padding in CSS pixels, as `fitBounds` takes it. */
export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * `base` padding on every edge plus the docked panel's inset on the left. With `mapWidth`
 * (the map container's CSS width) the left padding is clamped so `left + right < mapWidth`:
 * MapLibre refuses a fit whose horizontal padding meets or exceeds the canvas.
 */
export function withMapInset(base: number, inset: MapInset, mapWidth: number | null): MapPadding {
  let left = base + inset.left;
  if (mapWidth !== null) left = Math.min(left, Math.max(0, mapWidth - base - 1));
  return { top: base, right: base, bottom: base, left };
}

/**
 * The `offset` that centres a point in the padded area: `flyTo` and `easeTo` treat `padding`
 * as persistent transform padding (a jump that lingers), so flights take an offset instead.
 */
export function paddingOffset(padding: MapPadding): [number, number] {
  return [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2];
}

/**
 * `(base) => MapPadding` for a fit or flight: `base` on every edge plus the current
 * `mapInsetAtom` on the left, clamped to the map's width. The inset is read from the store
 * when called, so a flight scheduled for after the inspector opens sees its inset. Pass it to
 * `fitBounds` as `padding` (consumed once) and to `flyTo` as `offset: paddingOffset(...)`.
 */
export function useMapPadding() {
  const map = useMap();
  const store = useStore();

  return useEffectEvent((base: number): MapPadding => {
    // The container's CSS width: `getCanvas().width` is scaled by the device pixel ratio.
    const mapWidth = map?.getContainer().clientWidth ?? null;
    return withMapInset(base, store.get(mapInsetAtom), mapWidth);
  });
}

export function useFlyToEntity() {
  const map = useMap();
  const mapPadding = useMapPadding();

  return useEffectEvent((osm: Osm, entity: OsmEntity) => {
    if (!map) return;
    if (isNode(entity)) {
      map.flyTo({
        center: [entity.lon, entity.lat],
        offset: paddingOffset(mapPadding(0)),
        maxDuration: 200,
        zoom: 16,
      });
    } else if (isWay(entity)) {
      const bbox = osm.ways.getEntityBbox({ id: entity.id });
      map.fitBounds(bbox, {
        padding: mapPadding(100),
        maxDuration: 200,
      });
    } else if (isRelation(entity)) {
      const bbox = osm.relations.getEntityBbox({ id: entity.id });
      map.fitBounds(bbox, {
        padding: mapPadding(100),
        maxDuration: 200,
      });
    }
  });
}

/**
 * Select `entity` from `osm` and fly to it once the inspector has rendered. The selection
 * opens (or keeps) the docked inspector, which publishes its inset in an effect after the
 * commit; a flight in the same handler would read the inset as it was before the selection and
 * land the entity under the panel. Every select-then-fly goes through here so none can.
 */
export function useSelectAndFlyToEntity() {
  const selectOsmEntity = useSetAtom(selectOsmEntityAtom);
  const flyToEntity = useFlyToEntity();

  return useEffectEvent((osm: Osm, entity: OsmEntity) => {
    selectOsmEntity(osm, entity);
    requestAnimationFrame(() => flyToEntity(osm, entity));
  });
}

export function useFlyToOsmBounds() {
  const map = useMap();
  const mapPadding = useMapPadding();

  return useEffectEvent((osmInfo?: OsmInfo | null) => {
    // An empty dataset has no bbox; leave the camera where it is.
    const bbox = osmInfo?.bbox;
    if (!map || !bbox) return;
    map.fitBounds(bbox, {
      padding: mapPadding(100),
      maxDuration: 200,
    });
  });
}
