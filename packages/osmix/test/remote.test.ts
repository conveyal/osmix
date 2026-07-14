import { Osm } from "@osmix/core";
import { getFixtureFile, getFixtureFileReadStream, PBFs } from "@osmix/test-utils/fixtures";
import type { FeatureCollection, LineString, Point } from "geojson";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createRemote } from "../src/remote";

const monacoPbf = PBFs["monaco"]!;
const occupiedMonacoTile: [number, number, number] = [17059, 11948, 15];
// Increase timeout for worker tests
const workerTestTimeout = 30_000;

describe("OsmixRemote", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    // Clean up workers between tests
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe("fromPbf", () => {
    beforeAll(() => getFixtureFile(monacoPbf.url));

    it(
      "should load from PBF ArrayBuffer via worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const pbfData = await getFixtureFile(monacoPbf.url);
        const osm = await remote.fromPbf(pbfData.buffer);
        expect(osm.stats.nodes).toBe(monacoPbf.nodes);
      },
      workerTestTimeout,
    );
  });

  describe("fromGeoJSON", () => {
    it(
      "should preserve a full Uint8Array view",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const geojson: FeatureCollection<Point> = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [-122.4194, 37.7749] },
              properties: { name: "Full view" },
            },
          ],
        };

        const data = new TextEncoder().encode(JSON.stringify(geojson));
        const dataset = await remote.fromGeoJSON(data);

        expect(dataset.stats.nodes).toBe(1);
      },
      workerTestTimeout,
    );

    it(
      "should parse only the bytes in a Uint8Array subview",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const geojson: FeatureCollection<Point> = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [-122.4194, 37.7749] },
              properties: { name: "Subview" },
            },
          ],
        };

        const encoded = new TextEncoder().encode(JSON.stringify(geojson));
        const surrounding = new Uint8Array(encoded.byteLength + 2);
        surrounding[0] = 0xff;
        surrounding.set(encoded, 1);
        surrounding[surrounding.length - 1] = 0xee;
        const dataset = await remote.fromGeoJSON(surrounding.subarray(1, -1));

        expect(dataset.stats.nodes).toBe(1);
      },
      workerTestTimeout,
    );

    it(
      "should copy Node Buffer subviews before transferring",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const geojson: FeatureCollection<Point> = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [-122.4194, 37.7749] },
              properties: { name: "Buffer subview" },
            },
          ],
        };

        const encoded = Buffer.from(JSON.stringify(geojson));
        const surrounding = Buffer.alloc(encoded.byteLength + 2);
        surrounding[0] = 0xff;
        encoded.copy(surrounding, 1);
        surrounding[surrounding.length - 1] = 0xee;
        const dataset = await remote.fromGeoJSON(surrounding.subarray(1, -1));

        expect(dataset.stats.nodes).toBe(1);
      },
      workerTestTimeout,
    );

    it(
      "should load from GeoJSON via worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const geojson: FeatureCollection<Point> = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [-122.4194, 37.7749],
              },
              properties: {
                name: "San Francisco",
                amenity: "cafe",
              },
            },
          ],
        };

        const jsonString = JSON.stringify(geojson);
        const buffer = new TextEncoder().encode(jsonString).buffer;
        const osm = await remote.fromGeoJSON(buffer);

        expect(osm.stats.nodes).toBe(1);
        expect(osm.stats.ways).toBe(0);
      },
      workerTestTimeout,
    );

    it(
      "should load from GeoJSON ReadableStream via worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const geojson: FeatureCollection<LineString> = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: [
                  [-122.4194, 37.7749],
                  [-122.4094, 37.7849],
                ],
              },
              properties: {
                highway: "primary",
              },
            },
          ],
        };

        const jsonString = JSON.stringify(geojson);
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(jsonString));
            controller.close();
          },
        });
        const osm = await remote.fromGeoJSON(stream);

        expect(osm.stats.nodes).toBe(2);
        expect(osm.stats.ways).toBe(1);
      },
      workerTestTimeout,
    );
  });

  describe("get", () => {
    beforeAll(() => getFixtureFile(monacoPbf.url));

    it(
      "should retrieve instance from worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const pbfData = await getFixtureFile(monacoPbf.url);
        const osmInfo = await remote.fromPbf(pbfData.buffer, {
          id: "remote-get",
        });
        const osm = await osmInfo.get();

        expect(osm.id).toBe("remote-get");
        expect(osm.nodes.size).toBe(monacoPbf.nodes);
      },
      workerTestTimeout,
    );
  });

  describe("set", () => {
    beforeAll(() => getFixtureFile(monacoPbf.url));

    it(
      "should set instance in worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const pbfData = await getFixtureFile(monacoPbf.url);
        const osmInfo = await remote.fromPbf(pbfData.buffer, {
          id: "original-remote",
        });
        const osm = await osmInfo.transferOut();
        await remote.transferIn(new Osm({ ...osm.transferables(), id: "manual-set-remote" }));
        const retrieved = await remote.get("manual-set-remote");
        expect(retrieved.id).toBe("manual-set-remote");
        expect(retrieved.nodes.size).toBe(monacoPbf.nodes);
        expect(await remote.has("original-remote")).toBe(false);
      },
      workerTestTimeout,
    );
  });

  describe("delete", () => {
    beforeAll(() => getFixtureFile(monacoPbf.url));

    it(
      "should remove instance from worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const pbfData = await getFixtureFile(monacoPbf.url);
        const osm1 = await remote.fromPbf(pbfData.buffer);

        expect(await osm1.has()).toBe(true);
        await osm1.delete();
        expect(await osm1.has()).toBe(false);
      },
      workerTestTimeout,
    );
  });

  describe("isReady", () => {
    beforeAll(() => getFixtureFile(monacoPbf.url));

    it(
      "should check readiness via worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const pbfData = await getFixtureFile(monacoPbf.url);
        const osm = await remote.fromPbf(pbfData.buffer);

        expect(await osm.isReady()).toBe(true);
      },
      workerTestTimeout,
    );
  });

  describe("search", () => {
    beforeAll(() => getFixtureFile(monacoPbf.url));

    it(
      "should search via worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const fileStream = getFixtureFileReadStream(monacoPbf.url);
        const osm = await remote.fromPbf(fileStream);

        const result = await osm.search("name");
        expect(result).toHaveProperty("nodes");
        expect(result).toHaveProperty("ways");
        expect(result).toHaveProperty("relations");
        expect(Array.isArray(result.nodes)).toBe(true);
        expect(Array.isArray(result.ways)).toBe(true);
        expect(Array.isArray(result.relations)).toBe(true);
      },
      workerTestTimeout,
    );

    it(
      "should search by key and value via worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const fileStream = getFixtureFileReadStream(monacoPbf.url);
        const osm = await remote.fromPbf(fileStream);

        const result = await osm.search("highway", "residential");
        expect(result).toHaveProperty("nodes");
        expect(result).toHaveProperty("ways");
        expect(result).toHaveProperty("relations");
      },
      workerTestTimeout,
    );
  });

  describe("getVectorTile", () => {
    beforeAll(() => getFixtureFile(monacoPbf.url));

    it(
      "should generate vector tile via worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const fileStream = getFixtureFileReadStream(monacoPbf.url);
        const osm = await remote.fromPbf(fileStream);

        const tileData = await osm.getVectorTile(occupiedMonacoTile);

        expect(tileData).toBeInstanceOf(ArrayBuffer);
        expect(tileData.byteLength).toBeGreaterThan(0);
      },
      workerTestTimeout,
    );
  });

  describe("getRasterTile", () => {
    beforeAll(() => getFixtureFile(monacoPbf.url));

    it(
      "should generate raster tile via worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const fileStream = getFixtureFileReadStream(monacoPbf.url);
        const osm = await remote.fromPbf(fileStream);

        const tileData = await osm.getRasterTile(occupiedMonacoTile);

        expect(tileData).toBeInstanceOf(Uint8ClampedArray);
        expect(tileData.byteLength).toBe(256 * 256 * 4);
        expect(tileData.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
      },
      workerTestTimeout,
    );

    it(
      "should generate raster tile with custom tile size via worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const fileStream = getFixtureFileReadStream(monacoPbf.url);
        const osm = await remote.fromPbf(fileStream);

        const tileData = await osm.getRasterTile(occupiedMonacoTile, {
          tileSize: 512,
        });

        expect(tileData).toBeInstanceOf(Uint8ClampedArray);
        expect(tileData.byteLength).toBe(512 * 512 * 4);
        expect(tileData.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
      },
      workerTestTimeout,
    );
  });

  describe("dataset handle API", () => {
    it(
      "should expose instance methods without passing IDs",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const geojson: FeatureCollection<Point> = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [-122.4194, 37.7749],
              },
              properties: { amenity: "cafe", name: "Cafe" },
            },
          ],
        };

        const data = new TextEncoder().encode(JSON.stringify(geojson)).buffer;
        const dataset = await remote.fromGeoJSON(data, { id: "handle-test" });

        expect(dataset.id).toBe("handle-test");
        expect(dataset.stats.nodes).toBe(1);
        expect(await dataset.has()).toBe(true);
        expect(await dataset.isReady()).toBe(true);
        expect(await dataset.nodes.size()).toBe(1);
        const cafeNodes = await dataset.nodes.search("amenity", "cafe");
        expect(cafeNodes).toHaveLength(1);
        const cafe = cafeNodes[0];
        expect(cafe?.tags?.["name"]).toBe("Cafe");
        if (!cafe) throw Error("Expected cafe node");
        expect(await dataset.nodes.getById(cafe.id)).toEqual(cafe);
        const local = await dataset.get();
        expect(local.id).toBe("handle-test");
      },
      workerTestTimeout,
    );

    it(
      "should return a dataset handle from merge",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const point = (name: string, lon: number, lat: number): FeatureCollection<Point> => ({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, lat] },
              properties: { name },
            },
          ],
        });

        const base = await remote.fromGeoJSON(
          new TextEncoder().encode(JSON.stringify(point("base", -122.4, 37.7))).buffer,
          { id: "base-osm" },
        );
        const patch = await remote.fromGeoJSON(
          new TextEncoder().encode(JSON.stringify(point("patch", -122.41, 37.71))).buffer,
          { id: "patch-osm" },
        );

        const merged = await base.merge(patch);
        expect(merged.id).toBe("base-osm");
        expect(merged.stats.nodes).toBeGreaterThanOrEqual(1);
        expect(await remote.has("patch-osm")).toBe(false);
      },
      workerTestTimeout,
    );
  });

  describe("worker pool management", () => {
    beforeAll(() => getFixtureFile(monacoPbf.url));

    it(
      "should work with a single in-process worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        expect(remote.mode).toBe("in-process");
        expect(remote.workerCount).toBe(1);
        const pbfData = await getFixtureFile(monacoPbf.url);
        const osm = await remote.fromPbf(pbfData.buffer);
        expect(osm.stats.nodes).toBe(monacoPbf.nodes);
      },
      workerTestTimeout,
    );

    it("should throw without Web Worker support when inProcess is not set", async () => {
      // Node has no global Worker, so spawning real workers must fail loudly.
      await expect(createRemote()).rejects.toThrow(/Web Workers are not available/);
      await expect(createRemote({ workerCount: 3 })).rejects.toThrow(
        /Web Workers are not available/,
      );
    });

    it("should reject invalid worker pool configurations", async () => {
      await expect(createRemote({ workerCount: 0 })).rejects.toThrow(/at least 1/);
      await expect(createRemote({ workerCount: 2, inProcess: true })).rejects.toThrow(
        /only one worker/,
      );
      await expect(
        createRemote({
          inProcess: true,
          workerUrl: new URL("./osmix.worker.ts", import.meta.url),
        }),
      ).rejects.toThrow(/cannot be used in in-process mode/);
    });

    it("terminates raw workers exactly once when disposed", async () => {
      class MockWorker {
        static instances: MockWorker[] = [];

        readonly terminate = vi.fn();

        constructor() {
          MockWorker.instances.push(this);
        }

        addEventListener() {}

        postMessage() {}
      }

      vi.stubGlobal("Worker", MockWorker);
      const remote = await createRemote({ workerCount: 1 });

      remote.terminate();
      remote[Symbol.dispose]();

      expect(MockWorker.instances).toHaveLength(1);
      expect(MockWorker.instances[0]?.terminate).toHaveBeenCalledTimes(1);
      expect(remote.workerCount).toBe(0);
      expect(() => remote.mode).toThrow(/not initialized/);
    });

    it("cleans up workers created before initialization fails", async () => {
      class MockWorker {
        static instances: MockWorker[] = [];

        readonly terminate = vi.fn();

        constructor() {
          if (MockWorker.instances.length === 1) throw Error("second worker failed");
          MockWorker.instances.push(this);
        }

        addEventListener() {}

        postMessage() {}
      }

      vi.stubGlobal("Worker", MockWorker);

      await expect(createRemote({ workerCount: 2 })).rejects.toThrow("second worker failed");

      expect(MockWorker.instances).toHaveLength(1);
      expect(MockWorker.instances[0]?.terminate).toHaveBeenCalledTimes(1);
    });

    it("makes in-process disposal idempotent", async () => {
      const remote = await createRemote({ inProcess: true });

      expect(() => {
        remote.terminate();
        remote.terminate();
        remote[Symbol.dispose]();
      }).not.toThrow();
      expect(remote.workerCount).toBe(0);
      expect(() => remote.getWorker()).toThrow(/No worker available/);
    });
  });
});
