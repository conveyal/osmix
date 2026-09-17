import type { Osm } from "osmix";

import OsmixRasterSource from "./osmix-raster-source.tsx";
import OsmixVectorOverlay from "./osmix-vector-overlay.tsx";

/** Raster preview plus interactive overlay for a base dataset and an optional patch. */
export function OsmixMapSources({
  baseOsm,
  patchOsm = null,
}: {
  baseOsm: Osm | null;
  patchOsm?: Osm | null;
}) {
  return (
    <>
      {/* Dataset IDs are content hashes, so they change after a merge. react-map-gl
          source and layer IDs are immutable, so each map role and ID needs its own key. */}
      {baseOsm && <OsmixRasterSource key={`base:raster:${baseOsm.id}`} osmId={baseOsm.id} />}
      {patchOsm && <OsmixRasterSource key={`patch:raster:${patchOsm.id}`} osmId={patchOsm.id} />}
      {baseOsm && <OsmixVectorOverlay key={`base:overlay:${baseOsm.id}`} osm={baseOsm} />}
      {patchOsm && <OsmixVectorOverlay key={`patch:overlay:${patchOsm.id}`} osm={patchOsm} />}
    </>
  );
}
