import { useAtom, useAtomValue } from "jotai";
import type { GeoBbox2D } from "osmix";
import type { MapInstance } from "react-map-gl/maplibre";

import { useMap } from "../hooks/map";
import { extractBboxAtom } from "../state/extract";
import CustomControl from "./custom-control";
import ExtractBboxCornerMarkers, { bboxAfterCornerDrag } from "./extract-bbox-corner-markers";
import ExtractBboxLayer from "./extract-bbox-layer";
import { NominatimSearch } from "./nominatim-search-control";

function ExtractMapSearch() {
  const map = useMap();
  const [, setBbox] = useAtom(extractBboxAtom);

  return (
    <CustomControl position="top-right">
      <NominatimSearch
        map={(map ?? undefined) as MapInstance | undefined}
        onPlaceResolved={(result) => {
          const bbox = result.boundingbox?.map(Number);
          if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) {
            const [latSouth, latNorth, lonWest, lonEast] = bbox as [number, number, number, number];
            const next: GeoBbox2D = [lonWest, latSouth, lonEast, latNorth];
            setBbox(next);
          }
        }}
      />
    </CustomControl>
  );
}

export default function ExtractMapLayers() {
  const bbox = useAtomValue(extractBboxAtom);
  const [, setBbox] = useAtom(extractBboxAtom);

  return (
    <>
      <ExtractMapSearch />
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
