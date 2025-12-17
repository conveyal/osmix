export const APPID = "osmix"
export const MIN_NODE_ZOOM = 10
export const MIN_PICKABLE_ZOOM = 11
export const DEFAULT_BASE_PBF_URL = "./yakima-full.osm.pbf"
export const DEFAULT_PATCH_PBF_URL = "./yakima-osw.osm.pbf"

export const RASTER_PROTOCOL_NAME = "@osmix/raster"
export const RASTER_TILE_SIZE = 256
export const RASTER_TILE_IMAGE_TYPE = "image/png"

export const VECTOR_PROTOCOL_NAME = "@osmix/vector"

export const BASE_MAP_STYLES = {
	"carto-positron":
		"https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
	"carto-dark":
		"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
	"carto-voyager":
		"https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
} as const

export const DEFAULT_BASE_MAP_STYLE: keyof typeof BASE_MAP_STYLES = "carto-dark"

// IndexedDB database name
export const DB_NAME = "@osmix/storage"
export const DB_VERSION = 1 // Track bumps for database schema changes
export const OSM_STORE = "osm"
