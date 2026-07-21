import type { Osm, OsmInfo } from "osmix";
import { describe, expect, it, vi } from "vitest";

import { prepareMergedOsmState } from "../src/lib/merged-osm-state";

const info = (id: string): OsmInfo => ({
  bbox: [7.4, 43.7, 7.5, 43.8],
  header: {},
  id,
  spatialIndexes: {
    nodes: { all: true, tagged: true },
    ways: true,
  },
  stats: { nodes: 10, relations: 2, ways: 3 },
});

const osm = (id: string, contentHash: string, equal = false) =>
  ({
    contentHash: () => contentHash,
    id,
    info: () => info(id),
    isEqual: () => equal,
  }) as unknown as Osm;

describe("merged OSM state", () => {
  it("re-fetches a renamed dataset and returns content-addressed metadata", async () => {
    const beforeRename = osm("base", "merged-hash");
    const afterRename = osm("merged-hash", "merged-hash");
    const registry = new Map<string, Osm>([["base", beforeRename]]);
    const get = vi.fn(async (id: string) => {
      const registered = registry.get(id);
      if (!registered) throw Error(`Missing OSM ${id}`);
      return registered;
    });
    const rename = vi.fn(async (fromId: string, toId: string) => {
      if (!registry.delete(fromId)) throw Error(`Missing OSM ${fromId}`);
      registry.set(toId, afterRename);
    });

    const result = await prepareMergedOsmState({
      currentFileInfo: {
        fileHash: "base",
        fileName: "base.pbf",
        fileSize: 1,
      },
      currentOsm: osm("base", "base"),
      mergedFileName: "merged.pbf",
      newOsmId: "base",
      worker: { get, rename },
    });

    expect(rename).toHaveBeenCalledWith("base", "merged-hash");
    expect(get).toHaveBeenNthCalledWith(1, "base");
    expect(get).toHaveBeenNthCalledWith(2, "merged-hash");
    expect(await get(result.osm.id)).toBe(afterRename);
    expect(registry.has("base")).toBe(false);
    expect(result).toEqual({
      fileInfo: {
        fileHash: "merged-hash",
        fileName: "merged.pbf",
        fileSize: 900,
      },
      kind: "changed",
      osm: afterRename,
      osmInfo: info("merged-hash"),
    });
  });

  it("keeps source metadata when the applied changeset does not change content", async () => {
    const unchanged = osm("base", "base", true);
    const get = vi.fn<(id: string) => Promise<Osm>>().mockResolvedValue(unchanged);
    const rename = vi.fn<(fromId: string, toId: string) => Promise<void>>();

    const result = await prepareMergedOsmState({
      currentFileInfo: {
        fileHash: "base",
        fileName: "base.pbf",
        fileSize: 1,
      },
      currentOsm: osm("base", "base"),
      newOsmId: "base",
      worker: { get, rename },
    });

    expect(result).toEqual({ kind: "unchanged", osm: unchanged, osmInfo: info("base") });
    expect(rename).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledOnce();
  });

  it("does not rename a dataset that already uses its content hash", async () => {
    const merged = osm("merged-hash", "merged-hash");
    const get = vi.fn<(id: string) => Promise<Osm>>().mockResolvedValue(merged);
    const rename = vi.fn<(fromId: string, toId: string) => Promise<void>>();

    const result = await prepareMergedOsmState({
      currentFileInfo: null,
      currentOsm: null,
      newOsmId: "merged-hash",
      now: new Date("2026-07-21T01:02:03Z"),
      worker: { get, rename },
    });

    expect(result.kind).toBe("changed");
    if (result.kind === "changed") {
      expect(result.fileInfo.fileName).toBe("osmix-merged-2026-07-21T01-02-03.pbf");
      expect(result.osm.id).toBe("merged-hash");
      expect(result.osmInfo.id).toBe("merged-hash");
    }
    expect(rename).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledOnce();
  });
});
