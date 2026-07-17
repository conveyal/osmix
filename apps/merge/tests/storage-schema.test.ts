import { describe, expect, it, vi } from "vitest";

import { OSM_STORE } from "../src/settings";
import { type OsmSchemaUpgradeDatabase, upgradeOsmStore } from "../src/workers/storage-schema";

function fakeDatabase() {
  const createIndex = vi.fn();
  const createObjectStore = vi.fn(() => ({ createIndex }));
  const deleteObjectStore = vi.fn();
  return {
    createIndex,
    createObjectStore,
    deleteObjectStore,
    db: { createObjectStore, deleteObjectStore } satisfies OsmSchemaUpgradeDatabase,
  };
}

describe("upgradeOsmStore", () => {
  it("creates the v3 store and all indexes for a fresh database", () => {
    const fake = fakeDatabase();

    upgradeOsmStore(fake.db, 0);

    expect(fake.deleteObjectStore).not.toHaveBeenCalled();
    expect(fake.createObjectStore).toHaveBeenCalledWith(OSM_STORE, {
      keyPath: "fileHash",
    });
    expect(fake.createIndex.mock.calls).toEqual([
      ["by-stored-at", "storedAt"],
      ["by-hash", "fileHash"],
      ["by-last-accessed", "lastAccessedAt"],
    ]);
  });

  it.each([1, 2])("deletes and recreates an incompatible v%s store", (oldVersion) => {
    const fake = fakeDatabase();

    upgradeOsmStore(fake.db, oldVersion);

    expect(fake.deleteObjectStore).toHaveBeenCalledWith(OSM_STORE);
    expect(fake.deleteObjectStore.mock.invocationCallOrder[0]).toBeLessThan(
      fake.createObjectStore.mock.invocationCallOrder[0]!,
    );
    expect(fake.createIndex).toHaveBeenCalledTimes(3);
  });

  it("leaves a current v3 store unchanged", () => {
    const fake = fakeDatabase();

    upgradeOsmStore(fake.db, 3);

    expect(fake.deleteObjectStore).not.toHaveBeenCalled();
    expect(fake.createObjectStore).not.toHaveBeenCalled();
  });
});
