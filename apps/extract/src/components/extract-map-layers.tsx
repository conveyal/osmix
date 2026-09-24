import { nominatimPlaceAtom, type NominatimResult } from "@osmix/app-components";
import { useAtom, useAtomValue } from "jotai";
import type { GeoBbox2D } from "osmix";
import { useEffect, useEffectEvent } from "react";

import { extractBboxAtom, useFileBoundsAtom } from "../state/extract";
import ExtractBboxCornerMarkers, { bboxAfterCornerDrag } from "./extract-bbox-corner-markers";
import ExtractBboxLayer from "./extract-bbox-layer";

/** Nominatim returns `[latSouth, latNorth, lonWest, lonEast]` as strings. */
function nominatimResultToBbox(result: NominatimResult): GeoBbox2D | null {
  const bbox = result.boundingbox?.map(Number);
  if (!bbox || bbox.length !== 4 || !bbox.every(Number.isFinite)) return null;
  const [latSouth, latNorth, lonWest, lonEast] = bbox as [number, number, number, number];
  return [lonWest, latSouth, lonEast, latNorth];
}

export default function ExtractMapLayers() {
  const [bbox, setBbox] = useAtom(extractBboxAtom);
  const place = useAtomValue(nominatimPlaceAtom);
  const locked = useAtomValue(useFileBoundsAtom);

  // The shared map search resolves a place; use its bounding box as the extract bbox, unless the
  // bbox is locked to the file's bounds. Read the lock in an effect event so unlocking later
  // doesn't re-apply an old search result.
  const applyPlace = useEffectEvent((result: NominatimResult) => {
    if (locked) return;
    const next = nominatimResultToBbox(result);
    if (next) setBbox(next);
  });
  useEffect(() => {
    if (place) applyPlace(place);
  }, [place]);

  return (
    <>
      <ExtractBboxLayer bbox={bbox} />
      <ExtractBboxCornerMarkers
        bbox={bbox}
        locked={locked}
        onCornerDrag={(corner, lng, lat) =>
          setBbox((prev) => bboxAfterCornerDrag(prev, corner, lng, lat))
        }
      />
    </>
  );
}
