import { Osm } from "@osmix/core";
import { getFixtureFile, getFixtureFileReadStream, PBFs } from "@osmix/test-utils/fixtures";
import type { FeatureCollection, LineString, Point } from "geojson";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { fromPbf, type MergePlanOptions, merge, type PlanDecision } from "../src/index";
import { createRemote, OsmixDatasetLossError, OsmixRemote } from "../src/remote";
import { createBlockedBridgeFixture, entitySnapshot } from "./conflation-blocked-fixture";

const monacoPbf = PBFs["monaco"]!;
const occupiedMonacoTile: [number, number, number] = [17059, 11948, 15];
// Increase timeout for worker tests
const workerTestTimeout = 30_000;

function createParallelFootway(
  id: string,
  nodeId: number,
  wayId: number,
  lat: number,
  name: string,
) {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: nodeId, lon: 0, lat });
  osm.nodes.addNode({ id: nodeId + 1, lon: 0.001, lat });
  osm.nodes.buildIndex();
  osm.ways.addWay({
    id: wayId,
    refs: [nodeId, nodeId + 1],
    tags: { highway: "footway", name },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

class RecoveryTestRemote extends OsmixRemote {
  private readonly customSources = new Map<string, Uint8Array>();

  async restoreForTest(): Promise<void> {
    await this.restorePoolWorker(this.getWorker(), 0, 1);
  }

  decisionsForTest(id: string) {
    return this.broadcastToWorkers((worker) => worker.getLoadDecision(id));
  }

  hasForTest(id: string) {
    return this.broadcastToWorkers((worker) => worker.has(id));
  }

  deleteFromWorkerForTest(index: number, id: string) {
    return this.runOnWorker(index, (worker) => worker.delete(id));
  }

  restoreWorkerForTest(index: number): Promise<void> {
    return this.runOnWorker(index, (worker) => this.restorePoolWorker(worker, index, 1));
  }

  registerCustomGeoJson(id: string, data: Uint8Array): void {
    this.customSources.set(id, data);
    this.registerDatasetForRecovery(id);
  }

  registerMissing(id: string): void {
    this.registerDatasetForRecovery(id);
  }

  protected override async recoverDataset(worker: ReturnType<this["getWorker"]>, id: string) {
    const source = this.customSources.get(id);
    if (!source) return false;
    await worker.fromGeoJSON({ data: source.slice().buffer, options: { id } });
    return true;
  }
}

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

    it(
      "replicates load decisions, restores them after restart, and preserves them on rename",
      async () => {
        using remote = new RecoveryTestRemote();
        await remote.initializeWorkerPool(2);
        const pbfData = await getFixtureFile(monacoPbf.url);
        const dataset = await remote.fromPbf(pbfData.buffer, {
          id: "managed-load-decision",
          loadProfile: "view",
        });

        expect(
          (await remote.decisionsForTest(dataset.id)).map((decision) => decision?.resolvedProfile),
        ).toEqual(["view", "view"]);

        await remote.deleteFromWorkerForTest(1, dataset.id);
        expect(await remote.hasForTest(dataset.id)).toEqual([true, false]);
        await remote.restoreWorkerForTest(1);
        expect(
          (await remote.decisionsForTest(dataset.id)).map((decision) => decision?.resolvedProfile),
        ).toEqual(["view", "view"]);

        await dataset.rename("renamed-load-decision");
        expect(await remote.hasForTest("managed-load-decision")).toEqual([false, false]);
        expect(
          (await remote.decisionsForTest(dataset.id)).map((decision) => decision?.resolvedProfile),
        ).toEqual(["view", "view"]);
      },
      workerTestTimeout,
    );
  });

  describe("copy", () => {
    it(
      "registers a second id in every worker that survives replacing the original",
      async () => {
        using remote = new RecoveryTestRemote();
        await remote.initializeWorkerPool(2);
        const pbfData = await getFixtureFile(monacoPbf.url);
        const original = await remote.fromPbf(pbfData.buffer, {
          id: "copy-original",
          loadProfile: "view",
        });

        await remote.copy(original.id, "copy-target");
        expect(await remote.hasForTest("copy-target")).toEqual([true, true]);
        expect(
          (await remote.decisionsForTest("copy-target")).map((d) => d?.resolvedProfile),
        ).toEqual(["view", "view"]);
        const copied = await remote.get("copy-target");
        expect(copied.id).toBe("copy-target");
        expect(copied.info().stats.nodes).toBe(monacoPbf.nodes);

        // Replacing or deleting the original leaves the copy intact.
        await remote.delete(original.id);
        expect(await remote.hasForTest(original.id)).toEqual([false, false]);
        expect(await remote.hasForTest("copy-target")).toEqual([true, true]);

        // A restarted worker gets the copy back from its retained shared buffers.
        await remote.deleteFromWorkerForTest(1, "copy-target");
        await remote.restoreWorkerForTest(1);
        expect(await remote.hasForTest("copy-target")).toEqual([true, true]);

        await expect(remote.copy("copy-target", "copy-target")).rejects.toThrow(
          "Cannot copy dataset copy-target onto itself.",
        );
      },
      workerTestTimeout,
    );
  });

  describe("extract", () => {
    it(
      "extracts a loaded dataset exactly as from its PBF, and keeps the source",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const pbfData = await getFixtureFile(monacoPbf.url);
        const source = await remote.fromPbf(pbfData.slice().buffer, { id: "extract-source" });
        const bbox: [number, number, number, number] = [7.415, 43.73, 7.425, 43.74];
        const tagFilter = {
          nodes: [],
          ways: [{ key: "highway" }],
          relations: [],
        };
        for (const extractStrategy of ["simple", "complete_ways", "smart"] as const) {
          const options = { extractBbox: bbox, extractStrategy, extractTagFilter: tagFilter };
          const fromLoaded = await remote.extract(source.id, {
            ...options,
            id: `loaded-${extractStrategy}`,
          });
          const fromFile = await remote.fromPbf(pbfData.slice().buffer, {
            ...options,
            id: `file-${extractStrategy}`,
          });
          expect(fromLoaded.stats).toEqual(fromFile.stats);
          expect(fromLoaded.stats.ways).toBeGreaterThan(0);
          expect(fromLoaded.stats.ways).toBeLessThan(monacoPbf.ways);
        }
        expect((await remote.get(source.id)).info().stats.nodes).toBe(monacoPbf.nodes);
        await expect(
          remote.extract(source.id, { id: source.id, extractBbox: bbox }),
        ).rejects.toThrow("An extract of extract-source needs its own id.");
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

  describe("restart dataset recovery", () => {
    const ordinaryOptions: MergePlanOptions = {
      mergeIdenticalPoints: false,
      createIntersections: false,
    };
    const planOptions: MergePlanOptions = {
      ...ordinaryOptions,
      matching: { propertyKeys: ["name"], attachNetwork: false, automatic: "none" },
    };
    const acceptCopy: PlanDecision = { proposalId: "copy:w20>w10", action: "accept" };

    async function plannedInputs(remote: RecoveryTestRemote, id: string) {
      const base = createParallelFootway(`${id}-base`, 1, 10, 0, "Base path");
      const patch = createParallelFootway(`${id}-patch`, 11, 20, 0.000004, "Imported path");
      const ordinaryResult = entitySnapshot(await merge(base, patch, ordinaryOptions, () => {}));
      const matchedResult = entitySnapshot(
        await merge(base, patch, { ...planOptions, decisions: [acceptCopy] }, () => {}),
      );
      await remote.transferIn(base);
      await remote.transferIn(patch);
      await remote.planMerge(base.id, patch.id, planOptions);
      const decided = await remote.setMergePlanDecisions(base.id, [acceptCopy]);
      await remote.setMergePlanFilter(base.id, { kind: "copy-tags" });
      return { base, patch, decided, ordinaryResult, matchedResult };
    }

    async function restartInputs(remote: RecoveryTestRemote, ids: string[]) {
      for (const id of ids) await remote.getWorker().delete(id);
      await remote.restoreForTest();
    }

    const geojson: FeatureCollection<Point> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [7.42, 43.73] },
          properties: { name: "Replay me" },
        },
      ],
    };

    it("replays a File source without retaining a separate input buffer", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      const file = new File([JSON.stringify(geojson)], "replay.geojson", {
        type: "application/geo+json",
      });
      const dataset = await remote.fromGeoJSON(file, { id: "file-recovery" });
      await remote.getWorker().delete(dataset.id);

      await remote.restoreForTest();

      await expect(remote.has(dataset.id)).resolves.toBe(true);
    });

    it("uses subclass-owned durable recovery sources", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      const data = new TextEncoder().encode(JSON.stringify(geojson));
      const dataset = await remote.fromGeoJSON(data.slice(), { id: "custom-recovery" });
      remote.registerCustomGeoJson(dataset.id, data);
      await remote.getWorker().delete(dataset.id);

      await remote.restoreForTest();

      await expect(remote.has(dataset.id)).resolves.toBe(true);
    });

    it("throws a typed error instead of exposing an empty restarted worker", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      remote.registerMissing("one-shot-source");

      await expect(remote.restoreForTest()).rejects.toMatchObject({
        name: "OsmixDatasetLossError",
        datasetIds: ["one-shot-source"],
        workerIndex: 0,
      } satisfies Partial<OsmixDatasetLossError>);
    });

    it("reattaches the progress listener before a restored slot becomes available", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, vi.fn(), true);
      const worker = remote.getWorker();
      const addProgressListener = vi.spyOn(worker, "addProgressListener");

      await remote.restoreForTest();

      expect(addProgressListener).toHaveBeenCalledOnce();
    });

    it("rebuilds a merge plan with its decisions and filter after a restart", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      const base = createParallelFootway("plan-recovery-base", 1, 10, 0, "Base path");
      const patch = createParallelFootway("plan-recovery-patch", 11, 20, 0.000004, "Imported");
      await remote.transferIn(base);
      await remote.transferIn(patch);
      const planned = await remote.planMerge(base.id, patch.id, {
        matching: { propertyKeys: ["name"], attachNetwork: false, automatic: "none" },
      });
      expect(planned.summary.features["needs-decision"]).toBe(1);
      const decided = await remote.setMergePlanDecisions(base.id, [
        { proposalId: "copy:w20>w10", action: "accept" },
      ]);
      await remote.setMergePlanFilter(base.id, { kind: "copy-tags" });

      await remote.getWorker().clearMergePlan(base.id);
      await remote.restoreForTest();

      expect(await remote.getMergePlanOverview(base.id)).toEqual(decided);
      const page = await remote.getMergePlanPage(base.id, 0, 10);
      expect(page.features.map(({ key, outcome }) => [key, outcome])).toEqual([
        ["way:20", "merged"],
      ]);
    });

    it("refuses to rebuild a plan when a restored input is different data", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      const base = createParallelFootway("plan-drift-base", 1, 10, 0, "Base path");
      await remote.transferIn(base);
      const source = (name: string) =>
        new TextEncoder().encode(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [1, 1] },
                properties: { name },
              },
            ],
          }),
        );
      remote.registerCustomGeoJson("plan-drift-patch", source("First"));
      await remote.getWorker().fromGeoJSON({
        data: source("First").buffer,
        options: { id: "plan-drift-patch" },
      });
      await remote.planMerge(base.id, "plan-drift-patch");

      // The recovery source now yields different data under the same dataset ID.
      remote.registerCustomGeoJson("plan-drift-patch", source("Second"));
      await remote.deleteFromWorkerForTest(0, "plan-drift-patch");
      await expect(remote.restoreForTest()).rejects.toMatchObject({
        name: "OsmixPlanRecoveryError",
        baseOsmId: base.id,
        patchOsmId: "plan-drift-patch",
      });
      await expect(remote.getMergePlanOverview(base.id)).rejects.toThrow("No active merge plan");
    });

    it("restores hard blockers without turning an ignored acceptance into a tag transfer", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      const { base, patch } = createBlockedBridgeFixture();
      const options: MergePlanOptions = { createIntersections: false };
      const baseline = entitySnapshot(await merge(base, patch, options, () => {}));
      await remote.transferIn(base);
      await remote.transferIn(patch);
      await remote.planMerge(base.id, patch.id, {
        ...options,
        matching: { propertyKeys: ["name"], attachNetwork: false },
      });
      const decided = await remote.setMergePlanDecisions(base.id, [acceptCopy]);
      await remote.setMergePlanFilter(base.id, { status: "blocked" });
      const page = await remote.getMergePlanPage(base.id, 0, 1);
      const osc = await remote.getMergePlanOsc(base.id);

      await remote.getWorker().clearMergePlan(base.id);
      await remote.restoreForTest();

      expect(await remote.getMergePlanOverview(base.id)).toEqual(decided);
      expect(await remote.getMergePlanPage(base.id, 0, 1)).toEqual(page);
      expect(page.total).toBe(1);
      expect(
        page.features[0]?.proposals.find(({ id }) => id === acceptCopy.proposalId),
      ).toMatchObject({ status: "blocked", decision: "accept", effect: "blocked" });
      const bulk = await remote.applyMergePlanBulk(base.id, {
        action: "accept",
        filter: { kind: "copy-tags" },
      });
      expect(bulk.changed).toBe(0);
      expect(await remote.getMergePlanOsc(base.id)).toBe(osc);
      await remote.applyMergePlan(base.id);
      expect(entitySnapshot(await remote.transferOut(base.id))).toEqual(baseline);
    });

    it("keeps the prior plan recoverable when replanning fails", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      const { base, patch, decided, matchedResult } = await plannedInputs(remote, "failed-plan");
      const osc = await remote.getMergePlanOsc(base.id);

      await expect(remote.planMerge(base.id, "missing-patch", planOptions)).rejects.toThrow(
        "OSM not found for id: missing-patch",
      );
      expect(await remote.getMergePlanOverview(base.id)).toEqual(decided);

      await restartInputs(remote, [base.id, patch.id]);

      expect(await remote.getMergePlanOverview(base.id)).toEqual(decided);
      expect(await remote.getMergePlanOsc(base.id)).toBe(osc);
      await remote.applyMergePlan(base.id);
      expect(entitySnapshot(await remote.get(base.id))).toEqual(matchedResult);
    });

    it.each(["decisions", "bulk decision", "clear plan"] as const)(
      "journals a %s change for recovery",
      async (mutation) => {
        using remote = new RecoveryTestRemote();
        await remote.initializeWorkerPool(1, undefined, undefined, true);
        const { base, patch, ordinaryResult } = await plannedInputs(remote, `journal-${mutation}`);
        const rejected: PlanDecision = { ...acceptCopy, action: "reject" };

        if (mutation === "decisions") {
          await remote.setMergePlanDecisions(base.id, [rejected]);
        } else if (mutation === "bulk decision") {
          // A bulk choice never replaces a decision, so clear the planned accept first.
          for (const action of ["clear", "reject"] as const) {
            const bulk = await remote.applyMergePlanBulk(base.id, {
              action,
              filter: { kind: "copy-tags" },
            });
            expect(bulk.changed).toBe(1);
          }
        } else {
          await remote.clearMergePlan(base.id);
        }

        await restartInputs(remote, [base.id, patch.id]);

        if (mutation === "clear plan") {
          await expect(remote.getMergePlanOverview(base.id)).rejects.toThrow(
            "No active merge plan",
          );
          return;
        }
        expect((await remote.getMergePlanOverview(base.id)).decisions).toEqual([rejected]);
        await remote.applyMergePlan(base.id);
        expect(entitySnapshot(await remote.get(base.id))).toEqual(ordinaryResult);
      },
    );

    it("recovers independent plans for different bases", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      const first = await plannedInputs(remote, "first");
      const second = await plannedInputs(remote, "second");
      await remote.setMergePlanDecisions(first.base.id, []);
      const firstOverview = await remote.getMergePlanOverview(first.base.id);

      await restartInputs(remote, [first.base.id, first.patch.id, second.base.id, second.patch.id]);

      expect(await remote.getMergePlanOverview(first.base.id)).toEqual(firstOverview);
      expect(await remote.getMergePlanOverview(second.base.id)).toEqual(second.decided);
      await remote.applyMergePlan(second.base.id);
      expect(entitySnapshot(await remote.get(second.base.id))).toEqual(second.matchedResult);
      // Applying one plan must not forget another base's plan.
      await restartInputs(remote, [first.base.id, first.patch.id]);
      expect(await remote.getMergePlanOverview(first.base.id)).toEqual(firstOverview);
      await remote.applyMergePlan(first.base.id);
      expect(entitySnapshot(await remote.get(first.base.id))).toEqual(first.ordinaryResult);
    });

    it.each([
      { action: "replace", input: "base" },
      { action: "replace", input: "patch" },
      { action: "delete", input: "base" },
      { action: "delete", input: "patch" },
      { action: "rename", input: "base" },
      { action: "rename", input: "patch" },
    ] as const)(
      "does not revive a plan after $action of the $input input",
      async ({ action, input }) => {
        using remote = new RecoveryTestRemote();
        await remote.initializeWorkerPool(1, undefined, undefined, true);
        const { base, patch } = await plannedInputs(remote, `invalidate-${action}-${input}`);
        const changedId = input === "base" ? base.id : patch.id;

        if (action === "replace") {
          await remote.transferIn(createParallelFootway(changedId, 101, 110, 0.01, "Replacement"));
        } else if (action === "delete") {
          await remote.delete(changedId);
        } else {
          await remote.rename(changedId, `${changedId}-renamed`);
        }
        await expect(remote.getMergePlanOverview(base.id)).rejects.toThrow("No active merge plan");

        await remote.restoreForTest();

        await expect(remote.getMergePlanOverview(base.id)).rejects.toThrow("No active merge plan");
        if (action === "rename" && input === "base") {
          await expect(remote.getMergePlanOverview(`${base.id}-renamed`)).rejects.toThrow(
            "No active merge plan",
          );
        }
      },
    );

    it("does not replay a plan after a loader replaces an input ID", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      const { base, patch } = await plannedInputs(remote, "loader");

      const replacement: FeatureCollection<Point> = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 1] },
            properties: { name: "Replacement" },
          },
        ],
      };
      await remote.fromGeoJSON(new TextEncoder().encode(JSON.stringify(replacement)), {
        id: patch.id,
      });

      await expect(remote.restoreForTest()).resolves.toBeUndefined();
      await expect(remote.getMergePlanOverview(base.id)).rejects.toThrow("No active merge plan");
    });

    it("invalidates plans for both sides of an overwriting rename", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      const from = createParallelFootway("rename-from", 1, 10, 0, "From");
      const fromPatch = createParallelFootway("rename-from-patch", 11, 20, 0.000004, "Patch");
      const otherBase = createParallelFootway("rename-other-base", 21, 30, 0, "Other");
      const to = createParallelFootway("rename-to", 31, 40, 0.000004, "Destination");
      for (const osm of [from, fromPatch, otherBase, to]) await remote.transferIn(osm);
      await remote.planMerge(from.id, fromPatch.id, planOptions);
      await remote.planMerge(otherBase.id, to.id, planOptions);

      await remote.rename(from.id, to.id);
      await expect(remote.restoreForTest()).resolves.toBeUndefined();
      await expect(remote.getMergePlanOverview(from.id)).rejects.toThrow("No active merge plan");
      await expect(remote.getMergePlanOverview(otherBase.id)).rejects.toThrow(
        "No active merge plan",
      );
    });
  });

  describe("partial state broadcasts", () => {
    it("makes the remote terminal when a mutation fails after committing", async () => {
      using remote = new RecoveryTestRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      const data = new TextEncoder().encode(
        JSON.stringify({
          type: "FeatureCollection",
          features: [],
        }),
      );
      const dataset = await remote.fromGeoJSON(data, { id: "partial-delete" });
      const worker = remote.getWorker() as unknown as {
        delete(id: string): void;
      };
      const deleteDataset = worker.delete.bind(worker);
      worker.delete = (id) => {
        deleteDataset(id);
        throw new Error("failed after delete");
      };

      await expect(remote.delete(dataset.id)).rejects.toMatchObject({
        name: "OsmixRemoteStateError",
        operation: "dataset deletion",
      });
      await expect(remote.has(dataset.id)).rejects.toMatchObject({
        name: "OsmixRemoteStateError",
        operation: "dataset deletion",
      });
      await expect(remote.isReady(dataset.id)).rejects.toMatchObject({
        name: "OsmixRemoteStateError",
        operation: "dataset deletion",
      });
    });
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

  describe("PBF export", () => {
    beforeAll(() => getFixtureFile(monacoPbf.url));

    async function loadMonaco(remote: OsmixRemote, id: string) {
      const pbfData = await getFixtureFile(monacoPbf.url);
      return remote.fromPbf(pbfData.buffer, { id });
    }

    async function expectMonacoPbf(bytes: ArrayBuffer, id: string) {
      const reparsed = await fromPbf(new Uint8Array(bytes), { id });
      expect(reparsed.nodes.size).toBe(monacoPbf.nodes);
      expect(reparsed.ways.size).toBe(monacoPbf.ways);
      expect(reparsed.relations.size).toBe(monacoPbf.relations);
    }

    it(
      "builds a PBF Blob in the worker",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const dataset = await loadMonaco(remote, "export-blob");
        const blob = await dataset.toPbfBlob();
        expect(blob.type).toBe("application/x-protobuf");
        await expectMonacoPbf(await blob.arrayBuffer(), "export-blob-reparsed");
      },
      workerTestTimeout,
    );

    it(
      "writes a PBF through a file handle's writable",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const dataset = await loadMonaco(remote, "export-file");
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let closed = false;
        const fileHandle = {
          createWritable: async () =>
            new WritableStream<Uint8Array<ArrayBuffer>>({
              write(chunk) {
                chunks.push(chunk);
              },
              close() {
                closed = true;
              },
            }),
        } as unknown as FileSystemFileHandle;

        await dataset.toPbfFile(fileHandle);

        expect(closed).toBe(true);
        await expectMonacoPbf(await new Blob(chunks).arrayBuffer(), "export-file-reparsed");
      },
      workerTestTimeout,
    );

    it(
      "serializes in the worker when streams cannot be transferred",
      async () => {
        using remote = await createRemote({ inProcess: true });
        const dataset = await loadMonaco(remote, "export-stream-fallback");
        const get = vi.spyOn(remote, "get");
        const toPbfBlob = vi.spyOn(remote, "toPbfBlob");
        // `supportsReadableStreamTransfer()` needs a MessageChannel.
        vi.stubGlobal("MessageChannel", undefined);
        const output = new TransformStream<Uint8Array, Uint8Array>();
        const bytes = new Response(output.readable).arrayBuffer();

        await dataset.toPbf(output.writable);

        expect(toPbfBlob).toHaveBeenCalledOnce();
        expect(get).not.toHaveBeenCalled();
        await expectMonacoPbf(await bytes, "export-stream-fallback-reparsed");
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

    it(
      "reads a PBF header from a File through a real worker",
      async () => {
        const bytes = await getFixtureFile(monacoPbf.url);
        using remote = await createRemote({ workerCount: 1 });
        // A File is sent as its stream, which must be transferred, not cloned.
        const header = await remote.readHeader(new File([new Uint8Array(bytes)], "monaco.pbf"));
        expect(header.bbox).toEqual({
          left: 7.4053929,
          right: 7.4447259,
          top: 43.7543687,
          bottom: 43.7232244,
        });
      },
      workerTestTimeout,
    );

    it(
      "uses Node worker threads when Web Workers are unavailable",
      async () => {
        using remote = await createRemote({ workerCount: 1 });
        expect(remote.mode).toBe("single-worker");
        await expect(remote.runWithWorker((worker) => worker.ping())).resolves.toBe(true);
      },
      workerTestTimeout,
    );

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

    it("makes in-process disposal idempotent", async () => {
      const remote = await createRemote({ inProcess: true });

      expect(() => {
        remote.terminate();
        remote.terminate();
        remote[Symbol.dispose]();
      }).not.toThrow();
      expect(remote.workerCount).toBe(0);
      expect(() => remote.getWorker()).toThrow(/No worker available/);
      await Promise.all([remote.dispose(), remote.dispose(), remote[Symbol.asyncDispose]()]);
    });
  });
});
