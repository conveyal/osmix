import { describe, expect, expectTypeOf, it } from "vitest";

import {
  Osm,
  type OsmChangesetOptions,
  type OsmMergeOptions,
  OsmixRemote,
  OsmixWorker,
} from "../src/index";

const rejection =
  "generateChangeset does not support conflation; use generateConflationChangeset() or merge() instead";
const matching = { propertyKeys: ["name"], attachNetwork: false };
const decision = {
  candidateId: "node:101->1",
  action: "accept",
  transferProperties: true,
  attachNetwork: false,
} as const;

class InheritedOptions {
  directMerge = true;
  get conflation() {
    return matching;
  }
}

const invalidCases = [
  {
    name: "structurally wider merge options",
    make: () => {
      const options: Partial<OsmMergeOptions> = { directMerge: true, conflation: matching };
      return options;
    },
  },
  { name: "JavaScript null", make: () => ({ directMerge: true, conflation: null }) },
  { name: "JavaScript false", make: () => ({ directMerge: true, conflation: false }) },
  { name: "inherited configuration", make: () => new InheritedOptions() },
  {
    name: "non-enumerable configuration",
    make: () => Object.defineProperty({ directMerge: true }, "conflation", { value: matching }),
  },
  {
    name: "non-cloneable configuration",
    make: () => ({ directMerge: true, conflation: () => matching }),
  },
];

function inputs() {
  const base = new Osm({ id: "options-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { name: "Base point" } });
  const patch = new Osm({ id: "options-import" });
  patch.nodes.addNode({ id: 101, lon: 0.000005, lat: 0, tags: { name: "Imported point" } });
  for (const osm of [base, patch]) {
    osm.buildIndexes();
    osm.buildSpatialIndexes();
  }
  return { base, patch };
}

function entities(osm: Osm) {
  return {
    nodes: [...osm.nodes.sorted()],
    ways: [...osm.ways.sorted()],
    relations: [...osm.relations.sorted()],
  };
}

function expectedResult(base: Osm, patch: Osm, conflated: boolean) {
  return {
    nodes: [...base.nodes.sorted(), ...patch.nodes.sorted()].map((node) =>
      node.id === 1 && conflated ? { ...node, tags: { name: "Imported point" } } : node,
    ),
    ways: [],
    relations: [],
  };
}

class TestWorker extends OsmixWorker {
  add(osm: Osm) {
    this.set(osm.id, osm);
  }
  getOsm(id: string) {
    return this.get(id);
  }
}

class RecoveryRemote extends OsmixRemote {
  async restartForTest() {
    const worker = this.getWorker();
    await worker.delete("options-base");
    await worker.delete("options-import");
    await this.restorePoolWorker(worker, 0, 1);
  }
}

describe("ordinary changeset option boundaries", () => {
  it.each(invalidCases)("rejects $name before the worker reads datasets", async ({ make }) => {
    const worker = new TestWorker();
    await expect(
      worker.generateChangeset("missing-base", "missing-import", make()),
    ).rejects.toThrow(rejection);
  });

  it.each(invalidCases)(
    "rejects $name before remote cloning or worker dispatch",
    async ({ make }) => {
      using remote = new OsmixRemote();
      await expect(
        remote.generateChangeset("missing-base", "missing-import", make()),
      ).rejects.toThrow(rejection);
    },
  );

  it.each(["ordinary", "matching"] as const)(
    "preserves a worker's prior %s preview and review when options are rejected",
    async (prior) => {
      const { base, patch } = inputs();
      const worker = new TestWorker();
      worker.add(base);
      worker.add(patch);
      worker.discoverConflation(base.id, patch.id, matching);
      worker.setConflationDecision(base.id, decision);
      worker.setConflationFilter(base.id, { sourceId: 101, status: "accepted" });
      if (prior === "matching") worker.generateConflationChangeset(base.id, { directMerge: true });
      else await worker.generateChangeset(base.id, patch.id, { directMerge: true });
      const preview = structuredClone(worker.getChangesetPage(base.id, 0, 100));
      const review = structuredClone(worker.getConflationPage(base.id, 0, 100));
      for (const invalid of invalidCases) {
        await expect(worker.generateChangeset(base.id, patch.id, invalid.make())).rejects.toThrow(
          rejection,
        );
        expect(worker.getChangesetPage(base.id, 0, 100)).toEqual(preview);
        expect(worker.getConflationPage(base.id, 0, 100)).toEqual(review);
        expect(entities(worker.getOsm(base.id))).toEqual(entities(base));
        expect(entities(worker.getOsm(patch.id))).toEqual(entities(patch));
      }
      worker.applyChangesAndReplace(base.id);
      expect(entities(worker.getOsm(base.id))).toEqual(
        expectedResult(base, patch, prior === "matching"),
      );
    },
  );

  it.each(["ordinary", "matching"] as const)(
    "retains and recovers the remote's prior %s preview after rejection",
    async (prior) => {
      const { base, patch } = inputs();
      using remote = new RecoveryRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      await remote.transferIn(base);
      await remote.transferIn(patch);
      await remote.discoverConflation(base.id, patch.id, matching);
      await remote.setConflationDecision(base.id, decision);
      await remote.setConflationFilter(base.id, { sourceId: 101, status: "accepted" });
      if (prior === "matching")
        await remote.generateConflationChangeset(base.id, { directMerge: true });
      else await remote.generateChangeset(base.id, patch.id, { directMerge: true });
      const preview = structuredClone(await remote.getChangesetPage(base.id, 0, 100));
      const review = structuredClone(await remote.getConflationPage(base.id, 0, 100));
      for (const invalid of invalidCases) {
        await expect(remote.generateChangeset(base.id, patch.id, invalid.make())).rejects.toThrow(
          rejection,
        );
        expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(preview);
        expect(await remote.getConflationPage(base.id, 0, 100)).toEqual(review);
        expect(entities(await remote.get(base.id))).toEqual(entities(base));
        expect(entities(await remote.get(patch.id))).toEqual(entities(patch));
      }
      await remote.restartForTest();
      expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(preview);
      expect(await remote.getConflationPage(base.id, 0, 100)).toEqual(review);
      await remote.applyChangesAndReplace(base.id);
      expect(entities(await remote.get(base.id))).toEqual(
        expectedResult(base, patch, prior === "matching"),
      );
    },
  );

  it("allows absent or undefined conflation and keeps supported matching generation available", async () => {
    const { base, patch } = inputs();
    using remote = new OsmixRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    const ordinary = { directMerge: true, conflation: undefined };
    const generated = await remote.generateChangeset(base.id, patch.id, ordinary);
    expect(generated).toMatchObject({ nodeChanges: 1, totalChanges: 1 });
    const preview = await remote.getChangesetPage(base.id, 0, 100);
    await remote.generateChangeset(base.id, patch.id, { directMerge: true });
    expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(preview);
    await remote.discoverConflation(base.id, patch.id, matching);
    const conflated = await remote.generateConflationChangeset(base.id, { directMerge: true });
    expect(conflated.outcome.summary).toMatchObject({ tagCopyActions: 1, copiedTagValues: 1 });
    await remote.applyChangesAndReplace(base.id);
    expect(entities(await remote.get(base.id))).toEqual(expectedResult(base, patch, true));
  });

  it("exposes ordinary-only worker and remote option signatures", () => {
    type WorkerOptions = NonNullable<Parameters<OsmixWorker["generateChangeset"]>[2]>;
    type RemoteOptions = NonNullable<Parameters<OsmixRemote["generateChangeset"]>[2]>;
    expectTypeOf<WorkerOptions>().toEqualTypeOf<Partial<OsmChangesetOptions>>();
    expectTypeOf<RemoteOptions>().toEqualTypeOf<Partial<OsmChangesetOptions>>();
    expectTypeOf<Extract<keyof WorkerOptions, "conflation">>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof RemoteOptions, "conflation">>().toEqualTypeOf<never>();
  });
});
