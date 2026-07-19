import { inspectBackingBuffers } from "@osmix/shared/backing-buffers";
import { describe, expect, it } from "vitest";

import { OSM_CONTENT_HASH_VERSION, OSM_TRANSFER_VERSION, Osm } from "../src/osm.ts";
import StringTable from "../src/stringtable.ts";
import { Tags } from "../src/tags.ts";

describe("sparse tag storage", () => {
  it("rejects duplicate and out-of-order tagged entity indexes", () => {
    const tags = new Tags(new StringTable());
    tags.addTagKeysAndValues(2, [0], [1]);

    expect(() => tags.addTagKeysAndValues(2, [0], [1])).toThrow(/added out of order/);
    expect(() => tags.addTagKeysAndValues(1, [0], [1])).toThrow(/added out of order/);
  });

  it("preserves tags across rank boundaries and supports more than 255 tags", () => {
    const osm = new Osm({ id: "sparse-tags" });
    const manyTags = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [`key-${index}`, `value-${index}`]),
    );
    const taggedIndexes = new Set([0, 255, 256, 511, 512]);

    for (let index = 0; index <= 512; index++) {
      osm.nodes.addNode({
        id: index + 1,
        lon: index / 10,
        lat: index / 20,
        tags: index === 0 ? manyTags : taggedIndexes.has(index) ? { boundary: `${index}` } : {},
      });
    }
    osm.buildIndexes();

    expect(osm.nodes.tags.cardinality(0)).toBe(300);
    expect(osm.nodes.tags.cardinality(1)).toBe(0);
    expect(osm.nodes.tags.cardinality(255)).toBe(1);
    expect(osm.nodes.tags.cardinality(256)).toBe(1);
    expect(osm.nodes.tags.cardinality(511)).toBe(1);
    expect(osm.nodes.tags.cardinality(512)).toBe(1);
    expect([...osm.nodes.tags.taggedEntityIndexes()]).toEqual([0, 255, 256, 511, 512]);
    expect(osm.nodes.tags.taggedEntityCount).toBe(5);
    expect(Object.keys(osm.nodes.getByIndex(0).tags ?? {})).toHaveLength(300);

    const transferables = osm.transferables();
    expect(transferables.transferVersion).toBe(OSM_TRANSFER_VERSION);
    expect(transferables.contentHashVersion).toBe(OSM_CONTENT_HASH_VERSION);
    expect(transferables.nodes.taggedEntityBits.byteLength).toBe(
      Math.ceil(513 / 32) * Uint32Array.BYTES_PER_ELEMENT,
    );
    expect(transferables.nodes.tagRankCheckpoints.byteLength).toBe(
      (Math.ceil(513 / 256) + 1) * Uint32Array.BYTES_PER_ELEMENT,
    );
    expect(transferables.nodes.tagOffsets.byteLength).toBe(
      (taggedIndexes.size + 1) * Uint32Array.BYTES_PER_ELEMENT,
    );
    expect(osm.info().spatialIndexes).toEqual({
      nodes: { all: false, tagged: false },
      ways: false,
      relations: false,
    });

    const reconstructed = new Osm(transferables);
    expect([...reconstructed.nodes.tags.taggedEntityIndexes()]).toEqual([0, 255, 256, 511, 512]);
    expect(reconstructed.nodes.getByIndex(512).tags).toEqual({ boundary: "512" });
  });

  it("stores and searches an all-tagged collection across rank boundaries", () => {
    const osm = new Osm({ id: "all-tagged" });
    const entityCount = 257;

    for (let index = 0; index < entityCount; index++) {
      osm.nodes.addNode({
        id: index + 1,
        lon: index / 10,
        lat: index / 20,
        tags: { shared: index % 2 === 0 ? "even" : "odd", position: `${index}` },
      });
    }
    osm.buildIndexes();

    expect(osm.nodes.tags.taggedEntityCount).toBe(entityCount);
    expect([...osm.nodes.tags.taggedEntityIndexes()]).toEqual(
      Array.from({ length: entityCount }, (_, index) => index),
    );
    for (const index of [0, 31, 32, 255, 256]) {
      expect(osm.nodes.tags.cardinality(index)).toBe(2);
      expect(osm.nodes.getByIndex(index).tags).toEqual({
        shared: index % 2 === 0 ? "even" : "odd",
        position: `${index}`,
      });
    }
    expect([...osm.nodes].map(({ id }) => id)).toEqual(
      Array.from({ length: entityCount }, (_, index) => index + 1),
    );
    expect(osm.nodes.search("shared")).toHaveLength(entityCount);
    expect(osm.nodes.search("shared", "even").map(({ id }) => id)).toEqual(
      Array.from({ length: 129 }, (_, index) => index * 2 + 1),
    );

    const transferables = osm.transferables();
    expect(new Uint32Array(transferables.nodes.taggedEntityBits)).toEqual(
      new Uint32Array([
        0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff,
        0xffffffff, 1,
      ]),
    );
    expect(new Uint32Array(transferables.nodes.tagRankCheckpoints)).toEqual(
      new Uint32Array([0, 256, 257]),
    );
    expect(new Uint32Array(transferables.nodes.tagOffsets)).toEqual(
      new Uint32Array(Array.from({ length: entityCount + 1 }, (_, index) => index * 2)),
    );
    expect(Tags.getBytesRequired(entityCount, entityCount)).toBe(
      9 * Uint32Array.BYTES_PER_ELEMENT +
        3 * Uint32Array.BYTES_PER_ELEMENT +
        (entityCount + 1) * Uint32Array.BYTES_PER_ELEMENT,
    );

    const reconstructed = new Osm(transferables);
    expect(reconstructed.nodes.tags.taggedEntityCount).toBe(entityCount);
    expect(reconstructed.nodes.getByIndex(256).tags).toEqual({
      shared: "even",
      position: "256",
    });
    expect(reconstructed.nodes.search("shared", "odd")).toHaveLength(128);
    expect([...reconstructed.nodes.tags.taggedEntityIndexes()]).toHaveLength(entityCount);
  });

  it("stores and round-trips an all-untagged collection with only the offset sentinel", () => {
    const osm = new Osm({ id: "all-untagged" });
    const entityCount = 257;

    for (let index = 0; index < entityCount; index++) {
      osm.nodes.addNode({ id: index + 1, lon: index / 10, lat: index / 20 });
    }
    osm.buildIndexes();

    expect(osm.nodes.tags.taggedEntityCount).toBe(0);
    expect([...osm.nodes.tags.taggedEntityIndexes()]).toEqual([]);
    for (const index of [0, 31, 32, 255, 256]) {
      expect(osm.nodes.tags.cardinality(index)).toBe(0);
      expect(osm.nodes.getByIndex(index).tags).toBeUndefined();
    }
    expect([...osm.nodes].every((node) => node.tags === undefined)).toBe(true);
    expect(osm.nodes.search("missing-key")).toEqual([]);

    const transferables = osm.transferables();
    expect(new Uint32Array(transferables.nodes.taggedEntityBits)).toEqual(new Uint32Array(9));
    expect(new Uint32Array(transferables.nodes.tagRankCheckpoints)).toEqual(
      new Uint32Array([0, 0, 0]),
    );
    expect(new Uint32Array(transferables.nodes.tagOffsets)).toEqual(new Uint32Array([0]));
    expect(transferables.nodes.tagKeys.byteLength).toBe(0);
    expect(transferables.nodes.tagVals.byteLength).toBe(0);
    expect(Tags.getBytesRequired(entityCount, 0)).toBe(
      9 * Uint32Array.BYTES_PER_ELEMENT +
        3 * Uint32Array.BYTES_PER_ELEMENT +
        Uint32Array.BYTES_PER_ELEMENT,
    );

    const reconstructed = new Osm(transferables);
    expect(reconstructed.nodes.tags.taggedEntityCount).toBe(0);
    expect([...reconstructed.nodes.tags.taggedEntityIndexes()]).toEqual([]);
    expect(reconstructed.nodes.getByIndex(256)).toEqual({
      id: 257,
      lon: 25.6,
      lat: 12.8,
    });
    expect(reconstructed.nodes.search("missing-key")).toEqual([]);
  });

  it("preserves plain load diagnostics through info and transfer", () => {
    const osm = new Osm();
    osm.buildIndexes();
    osm.setLoadDiagnostics({
      requestedProfile: "auto",
      selectedProfile: "view",
      reasons: [{ code: "large", level: "warning", message: "View selected" }],
      bytes: {
        residentTypedBuffers: 100,
        projectedTypedBufferPeak: 200,
        largestPlannedAllocation: 50,
        storageBytes: 75,
      },
      budgets: { workingSet: 150, singleAllocation: 60 },
      phaseTimingsMs: { parse: 10 },
      counters: { taggedNodes: 0, wayReferences: 0, relationMembers: 0 },
    });

    expect(osm.info().loadDiagnostics?.selectedProfile).toBe("view");
    expect(new Osm(osm.transferables()).info().loadDiagnostics).toEqual(osm.info().loadDiagnostics);
  });
});

describe("indexed way references", () => {
  it("stores resolved node indexes and losslessly preserves sparse missing IDs", () => {
    const osm = new Osm({ id: "way-refs" });
    osm.nodes.addNode({ id: 10, lon: 1, lat: 2 });
    osm.nodes.addNode({ id: 20, lon: 3, lat: 4 });
    osm.ways.addWay({ id: 100, refs: [999, 10, 998] });
    osm.ways.addWay({ id: 101, refs: [10, 997, 20] });
    osm.buildIndexes();

    expect(osm.ways.getRefIds(0)).toEqual([999, 10, 998]);
    expect(osm.ways.getRefIds(1)).toEqual([10, 997, 20]);
    expect(() => osm.ways.getCoordinates(0)).toThrow("Node 999 not found for way geometry");

    const transferables = osm.transferables();
    expect(transferables.ways.refs.byteLength).toBe(6 * Uint32Array.BYTES_PER_ELEMENT);
    expect(new Uint32Array(transferables.ways.missingRefPositions)).toEqual(
      new Uint32Array([0, 2, 4]),
    );
    expect(new Float64Array(transferables.ways.missingRefIds)).toEqual(
      new Float64Array([999, 998, 997]),
    );

    const reconstructed = new Osm(transferables);
    expect(reconstructed.ways.getRefIds(0)).toEqual([999, 10, 998]);
    expect(reconstructed.ways.getRefIds(1)).toEqual([10, 997, 20]);
  });

  it("produces the same content hash for pending IDs and directly indexed refs", () => {
    const deferred = new Osm({ id: "deferred" });
    deferred.nodes.addNode({ id: 10, lon: 1, lat: 2 });
    deferred.nodes.addNode({ id: 20, lon: 3, lat: 4 });
    deferred.ways.addWay({ id: 100, refs: [10, 20] });
    deferred.buildIndexes();

    const direct = new Osm({ id: "direct" });
    direct.nodes.addNode({ id: 10, lon: 1, lat: 2 });
    direct.nodes.addNode({ id: 20, lon: 3, lat: 4 });
    direct.nodes.buildIndex();
    direct.ways.addWays(
      [{ id: 100, keys: [], vals: [], refs: [10, 10] }],
      new Uint32Array(),
      undefined,
      (id) => direct.nodes.ids.getIndexFromId(id),
    );
    direct.buildIndexes();

    expect(direct.ways.getRefIds(0)).toEqual([10, 20]);
    expect(direct.contentHash()).toBe(deferred.contentHash());
  });
});

describe("empty spatial capabilities", () => {
  it("marks requested empty way and relation indexes as built", () => {
    const osm = new Osm({ id: "empty-spatial-indexes" });
    osm.buildIndexes();

    osm.ways.buildSpatialIndex();
    osm.relations.buildSpatialIndex();

    expect(osm.ways.hasSpatialIndex()).toBe(true);
    expect(osm.relations.hasSpatialIndex()).toBe(true);
    expect(osm.info().spatialIndexes).toMatchObject({
      ways: true,
      relations: true,
    });

    const transferables = osm.transferables();
    const inspection = inspectBackingBuffers(transferables);
    expect(inspection.arrayBuffers).toBe(0);

    const restored = new Osm(transferables);
    expect(restored.ways.hasSpatialIndex()).toBe(true);
    expect(restored.relations.hasSpatialIndex()).toBe(true);
  });
});
