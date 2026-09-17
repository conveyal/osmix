/** Prefix for every MapLibre source and layer id the Osmix components add to the basemap. */
export const APPID = "osmix";
/** Entities become clickable in the vector overlay from this zoom. */
export const MIN_PICKABLE_ZOOM = 11;

export const RASTER_PROTOCOL_NAME = "@osmix/raster";
export const RASTER_TILE_SIZE = 256;

export const VECTOR_PROTOCOL_NAME = "@osmix/vector";

export const BASE_MAP_STYLES = {
  "carto-positron": "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  "carto-dark": "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  "carto-voyager": "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
} as const;

export const DEFAULT_BASE_MAP_STYLE: keyof typeof BASE_MAP_STYLES = "carto-dark";
