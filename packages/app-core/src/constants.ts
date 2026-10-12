// IndexedDB database name
export const DB_NAME = "@osmix/storage";
// v3 invalidates cached transferables after the spatial-index storage schema changed.
// v4 adds saved merge review decisions.
export const DB_VERSION = 4;
export const OSM_STORE = "osm";
export const MERGE_DECISIONS_STORE = "merge-decisions";

// BroadcastChannel name for storage notifications
export const STORAGE_CHANNEL = "@osmix/storage-channel";
