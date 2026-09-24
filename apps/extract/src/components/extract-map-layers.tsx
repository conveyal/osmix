import { nominatimPlaceAtom, type NominatimResult } from "@osmix/app-components";
import { useAtom, useAtomValue } from "jotai";
import type { GeoBbox2D } from "osmix";
import { useEffect } from "react";

import { extractBboxAtom } from "../state/extract";
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

  // The shared map search resolves a place; use its bounding box as the extract bbox.
  useEffect(() => {
    if (!place) return;
    const next = nominatimResultToBbox(place);
    if (next) setBbox(next);
  }, [place, setBbox]);

  return (
    <>
      <ExtractBboxLayer bbox={bbox} />
      <ExtractBboxCornerMarkers
        bbox={bbox}
        onCornerDrag={(corner, lng, lat) =>
          setBbox((prev) => bboxAfterCornerDrag(prev, corner, lng, lat))
        }
      />
    </>
  );
}
