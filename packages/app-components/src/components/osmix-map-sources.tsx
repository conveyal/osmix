import type { Osm } from "osmix";

import OsmixRasterSource from "./osmix-raster-source.tsx";
import OsmixVectorOverlay from "./osmix-vector-overlay.tsx";

/**
 * Raster preview plus interactive overlay for a base dataset and an optional patch, drawn in
 * the `base` and `patch` map colors. `baseVisible` and `patchVisible` hide a dataset's layers
 * without unmounting them.
 */
export function OsmixMapSources({
  baseOsm,
  patchOsm = null,
  baseVisible = true,
  patchVisible = true,
}: {
  baseOsm: Osm | null;
  patchOsm?: Osm | null;
  baseVisible?: boolean;
  patchVisible?: boolean;
}) {
  return (
    <>
      {/* Dataset IDs are content hashes, so they change after a merge. react-map-gl
          source and layer IDs are immutable, so each map role and ID needs its own key. */}
      {baseOsm && (
        <OsmixRasterSource
          key={`base:raster:${baseOsm.id}`}
          osmId={baseOsm.id}
          visible={baseVisible}
        />
      )}
      {patchOsm && (
        <OsmixRasterSource
          key={`patch:raster:${patchOsm.id}`}
          osmId={patchOsm.id}
          role="patch"
          visible={patchVisible}
        />
      )}
      {baseOsm && (
        <OsmixVectorOverlay
          key={`base:overlay:${baseOsm.id}`}
          osm={baseOsm}
          visible={baseVisible}
        />
      )}
      {patchOsm && (
        <OsmixVectorOverlay
          key={`patch:overlay:${patchOsm.id}`}
          osm={patchOsm}
          role="patch"
          visible={patchVisible}
        />
      )}
    </>
  );
}
