import { Layer, Source } from "react-map-gl/maplibre";

import { APPID, MIN_PICKABLE_ZOOM, RASTER_TILE_SIZE } from "../constants.ts";
import { osmixIdToTileUrl, type RasterColorRole } from "../lib/osmix-raster-protocol.ts";
import { FADED_OPACITY } from "./osmix-vector-overlay.tsx";

/**
 * Raster preview of a dataset below `MIN_PICKABLE_ZOOM`, drawn in the `role` map color. The
 * role prefixes the source id, so one file loaded in both Merge slots gets two sources.
 * `visible={false}` keeps the layer mounted but hidden; `faded` draws it behind the page's layers.
 */
export default function OsmixRasterSource({
  osmId,
  role = "base",
  tileSize = RASTER_TILE_SIZE,
  visible = true,
  faded = false,
}: {
  osmId: string;
  role?: RasterColorRole;
  tileSize?: number;
  visible?: boolean;
  faded?: boolean;
}) {
  const id = `${APPID}:${role}:${osmId}:${tileSize}:raster`;
  return (
    <Source
      // react-map-gl treats a source ID as immutable. Merging replaces the base
      // dataset ID, so key the source by that ID to remount it instead of asking
      // the existing MapLibre source to change identity.
      key={id}
      id={id}
      type="raster"
      tiles={[osmixIdToTileUrl(osmId, tileSize, role)]}
      tileSize={tileSize / 2}
    >
      <Layer
        id={id}
        type="raster"
        source={id}
        maxzoom={MIN_PICKABLE_ZOOM}
        layout={{ visibility: visible ? "visible" : "none" }}
        paint={{ "raster-opacity": faded ? FADED_OPACITY : 1 }}
      />
    </Source>
  );
}
