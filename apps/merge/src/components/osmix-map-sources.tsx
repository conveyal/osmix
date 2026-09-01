import type { Osm } from "osmix";

import OsmixRasterSource from "./osmix-raster-source";
import OsmixVectorOverlay from "./osmix-vector-overlay";

export function OsmixMapSources({
  activeTab,
  baseOsm,
  extractOsm,
  patchOsm,
}: {
  activeTab: string;
  baseOsm: Osm | null;
  extractOsm: Osm | null;
  patchOsm: Osm | null;
}) {
  return (
    <>
      {/* Dataset IDs are content hashes, so they change after a merge. react-map-gl
          source and layer IDs are immutable, so each map role and ID needs its own key. */}
      {baseOsm && <OsmixRasterSource key={`base:raster:${baseOsm.id}`} osmId={baseOsm.id} />}
      {patchOsm && <OsmixRasterSource key={`patch:raster:${patchOsm.id}`} osmId={patchOsm.id} />}
      {baseOsm && <OsmixVectorOverlay key={`base:overlay:${baseOsm.id}`} osm={baseOsm} />}
      {patchOsm && <OsmixVectorOverlay key={`patch:overlay:${patchOsm.id}`} osm={patchOsm} />}
      {activeTab === "Extract" && extractOsm ? (
        <>
          <OsmixRasterSource key={`extract:raster:${extractOsm.id}`} osmId={extractOsm.id} />
          <OsmixVectorOverlay key={`extract:overlay:${extractOsm.id}`} osm={extractOsm} />
        </>
      ) : null}
    </>
  );
}
