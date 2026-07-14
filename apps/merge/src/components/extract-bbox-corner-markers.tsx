import type { GeoBbox2D } from "osmix";
import { useState } from "react";
import type { MarkerDragEvent } from "react-map-gl/maplibre";
import { Marker } from "react-map-gl/maplibre";

export type BboxCornerId = "sw" | "se" | "ne" | "nw";

/**
 * Normalize unordered west/east and south/north into GeoBbox2D [minLon, minLat, maxLon, maxLat].
 */
function normalizeBboxEdges(west: number, south: number, east: number, north: number): GeoBbox2D {
  let minLon = Math.min(west, east);
  let maxLon = Math.max(west, east);
  let minLat = Math.min(south, north);
  let maxLat = Math.max(south, north);

  minLon = Math.max(-180, Math.min(180, minLon));
  maxLon = Math.max(-180, Math.min(180, maxLon));
  minLat = Math.max(-90, Math.min(90, minLat));
  maxLat = Math.max(-90, Math.min(90, maxLat));

  if (minLon >= maxLon) {
    const mid = (minLon + maxLon) / 2;
    minLon = mid - 1e-7;
    maxLon = mid + 1e-7;
  }
  if (minLat >= maxLat) {
    const mid = (minLat + maxLat) / 2;
    minLat = mid - 1e-7;
    maxLat = mid + 1e-7;
  }

  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Apply a dragged corner position to the bbox.
 *
 * Each corner controls its two meeting edges (e.g. SW sets west + south). The old
 * min/max-of-four-points approach failed when shrinking inward: NW still pinned
 * `west` so dragging SW east did not move the western boundary.
 */
export function bboxAfterCornerDrag(
  bbox: GeoBbox2D,
  corner: BboxCornerId,
  lng: number,
  lat: number,
): GeoBbox2D {
  const [w, s, e, n] = bbox;
  switch (corner) {
    case "sw":
      return normalizeBboxEdges(lng, lat, e, n);
    case "se":
      return normalizeBboxEdges(w, lat, lng, n);
    case "ne":
      return normalizeBboxEdges(w, s, lng, lat);
    case "nw":
      return normalizeBboxEdges(lng, s, e, lat);
  }
}

const CORNERS: { id: BboxCornerId; label: string }[] = [
  { id: "sw", label: "Southwest corner of extract bbox" },
  { id: "se", label: "Southeast corner of extract bbox" },
  { id: "ne", label: "Northeast corner of extract bbox" },
  { id: "nw", label: "Northwest corner of extract bbox" },
];

function lngLatForCorner(id: BboxCornerId, bbox: GeoBbox2D): [number, number] {
  const [w, s, e, n] = bbox;
  switch (id) {
    case "sw":
      return [w, s];
    case "se":
      return [e, s];
    case "ne":
      return [e, n];
    case "nw":
      return [w, n];
  }
}

/**
 * While dragging, MapLibre moves the marker imperatively but React still passes
 * stale `longitude`/`latitude` until parent state commits — the marker snaps back.
 * We mirror the drag position locally so controlled props stay in sync every frame.
 */
export default function ExtractBboxCornerMarkers({
  bbox,
  onCornerDrag,
}: {
  bbox: GeoBbox2D;
  onCornerDrag: (corner: BboxCornerId, lng: number, lat: number) => void;
}) {
  const [dragOverride, setDragOverride] = useState<{
    corner: BboxCornerId;
    lng: number;
    lat: number;
  } | null>(null);

  return (
    <>
      {CORNERS.map(({ id, label }) => {
        const fromBbox = lngLatForCorner(id, bbox);
        const useOverride = dragOverride?.corner === id;
        const longitude = useOverride ? dragOverride.lng : fromBbox[0];
        const latitude = useOverride ? dragOverride.lat : fromBbox[1];

        return (
          <Marker
            key={id}
            longitude={longitude}
            latitude={latitude}
            draggable
            onDragStart={(ev: MarkerDragEvent) => {
              const { lng, lat } = ev.lngLat;
              setDragOverride({ corner: id, lng, lat });
            }}
            onDrag={(ev: MarkerDragEvent) => {
              const { lng, lat } = ev.lngLat;
              setDragOverride({ corner: id, lng, lat });
              onCornerDrag(id, lng, lat);
            }}
            onDragEnd={() => {
              // Let the last `onDrag` bbox update commit before dropping override.
              requestAnimationFrame(() => {
                setDragOverride(null);
              });
            }}
            anchor="center"
          >
            <div
              className="size-4 rounded-full border-2 border-white bg-info shadow-md cursor-grab active:cursor-grabbing ring-2 ring-info/40 touch-none"
              aria-label={label}
              role="button"
              tabIndex={0}
            />
          </Marker>
        );
      })}
    </>
  );
}
