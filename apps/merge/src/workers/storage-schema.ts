import { OSM_STORE } from "../settings";

export interface OsmSchemaUpgradeDatabase {
  createObjectStore(
    name: string,
    options: { keyPath: string },
  ): { createIndex(name: string, keyPath: string): unknown };
  deleteObjectStore(name: string): void;
}

function createOsmStore(db: OsmSchemaUpgradeDatabase): void {
  const store = db.createObjectStore(OSM_STORE, { keyPath: "fileHash" });
  store.createIndex("by-stored-at", "storedAt");
  store.createIndex("by-hash", "fileHash");
  store.createIndex("by-last-accessed", "lastAccessedAt");
}

/** Recreate v1/v2 records because their transferable schema is incompatible with v3. */
export function upgradeOsmStore(db: OsmSchemaUpgradeDatabase, oldVersion: number): void {
  if (oldVersion === 0) {
    createOsmStore(db);
    return;
  }
  if (oldVersion < 3) {
    db.deleteObjectStore(OSM_STORE);
    createOsmStore(db);
  }
}
