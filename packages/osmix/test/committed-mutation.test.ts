import { describe, expect, it, vi } from "vitest";

import { Osm, type OsmId, OsmixRemote } from "../src/index";

class SyncFailureRemote extends OsmixRemote {
  failNextSynchronization = false;
  failNextReplication = false;

  protected override async populateDatasetFromControl(osmId: OsmId) {
    if (this.failNextReplication) {
      this.failNextReplication = false;
      await this.broadcastStateChange("dataset replication", async () => {
        throw Error("Simulated terminal replication failure");
      });
    }
    if (this.failNextSynchronization) {
      this.failNextSynchronization = false;
      throw Error("Simulated result synchronization failure");
    }
    await super.populateDatasetFromControl(osmId);
  }

  async restartForTest(outputId?: string) {
    const worker = this.getWorker();
    await worker.delete("committed-base");
    await worker.delete("committed-patch");
    if (outputId) await worker.delete(outputId);
    await this.restorePoolWorker(worker, 0, 1);
  }
}

function inputs() {
  const base = new Osm({ id: "committed-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { tactile_paving: "no" } });
  const patch = new Osm({ id: "committed-patch" });
  patch.nodes.addNode({ id: 101, lon: 0.000005, lat: 0, tags: { tactile_paving: "yes" } });
  for (const osm of [base, patch]) {
    osm.buildIndexes();
    osm.buildSpatialIndexes();
  }
  return { base, patch };
}

describe("committed remote mutations", () => {
  it("identifies a committed changeset when synchronization fails and retries without reapplying", async () => {
    const { base, patch } = inputs();
    using remote = new SyncFailureRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    await remote.discoverConflation(base.id, patch.id, {
      propertyKeys: ["tactile_paving"],
      attachNetwork: false,
    });
    const generation = await remote.generateConflationChangeset(base.id, { directMerge: true });
    const outcome = structuredClone(generation.outcome);
    const apply = vi.spyOn(remote.getWorker(), "applyChangesAndReplace");
    remote.failNextSynchronization = true;
    await expect(remote.applyChangesAndReplace(base.id)).rejects.toMatchObject({
      name: "OsmixCommittedMutationError",
      committed: true,
      operation: "applyChangesAndReplace",
      osmId: base.id,
      cause: { message: "Simulated result synchronization failure" },
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(await remote.getWorker().nodesGetById(base.id, 1)).toMatchObject({
      tags: { tactile_paving: "yes" },
    });
    await expect(remote.getChangesetPage(base.id, 0, 100)).rejects.toThrow("No active changeset");
    expect(generation.outcome).toEqual(outcome);

    await remote.synchronizeDataset(base.id);
    const actual = await remote.get(base.id);
    expect(actual.nodes.getById(1)?.tags?.["tactile_paving"]).toBe("yes");
    expect(actual.nodes.getById(101)?.tags?.["tactile_paving"]).toBe("yes");
    expect(apply).toHaveBeenCalledTimes(1);
    await remote.restartForTest();
    expect([...(await remote.get(base.id)).nodes.sorted()]).toEqual([...actual.nodes.sorted()]);
    expect(generation.outcome).toEqual(outcome);
  });

  it("identifies a committed direct merge with the returned output ID", async () => {
    const { base, patch } = inputs();
    using remote = new SyncFailureRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    const merge = vi.spyOn(remote.getWorker(), "merge");
    remote.failNextSynchronization = true;
    let caught: unknown;
    try {
      await remote.merge(base.id, patch.id, { directMerge: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      name: "OsmixCommittedMutationError",
      committed: true,
      operation: "merge",
      osmId: base.id,
      cause: { message: "Simulated result synchronization failure" },
    });
    expect(merge).toHaveBeenCalledTimes(1);
    await remote.synchronizeDataset(base.id);
    const actual = await remote.get(base.id);
    expect([...actual.nodes.sorted()]).toEqual([...base.nodes.sorted(), ...patch.nodes.sorted()]);
    expect(merge).toHaveBeenCalledTimes(1);
    await remote.restartForTest();
    expect(await remote.has(patch.id)).toBe(false);
    expect([...(await remote.get(base.id)).nodes.sorted()]).toEqual([...actual.nodes.sorted()]);
  });

  it("uses a custom worker's returned dataset ID after a committed merge", async () => {
    const { base, patch } = inputs();
    using remote = new SyncFailureRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    const worker = remote.getWorker();
    const merge = worker.merge.bind(worker);
    const outputId = "committed-output";
    vi.spyOn(worker, "merge").mockImplementation(async (...args) => {
      await merge(...args);
      const buffers = await worker.getOsmBuffers(base.id);
      await worker.transferIn({ ...buffers, id: outputId });
      return outputId;
    });
    remote.failNextSynchronization = true;
    await expect(remote.merge(base.id, patch.id, { directMerge: true })).rejects.toMatchObject({
      committed: true,
      operation: "merge",
      osmId: outputId,
    });
    await remote.synchronizeDataset(outputId);
    const actual = await remote.get(outputId);
    expect([...actual.nodes.sorted()]).toEqual([...base.nodes.sorted(), ...patch.nodes.sorted()]);
    expect(worker.merge).toHaveBeenCalledTimes(1);
    await remote.restartForTest(outputId);
    expect(await remote.has(patch.id)).toBe(false);
    expect([...(await remote.get(outputId)).nodes.sorted()]).toEqual([...actual.nodes.sorted()]);
  });

  it("preserves committed metadata while terminal replication failures stay terminal", async () => {
    const { base, patch } = inputs();
    using remote = new SyncFailureRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    await remote.discoverConflation(base.id, patch.id, {
      propertyKeys: ["tactile_paving"],
      attachNetwork: false,
    });
    const generation = await remote.generateConflationChangeset(base.id, { directMerge: true });
    const apply = vi.spyOn(remote.getWorker(), "applyChangesAndReplace");
    remote.failNextReplication = true;
    await expect(remote.applyChangesAndReplace(base.id)).rejects.toMatchObject({
      committed: true,
      operation: "applyChangesAndReplace",
      osmId: base.id,
      cause: { name: "OsmixRemoteStateError", operation: "dataset replication" },
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(generation.outcome.summary.copiedTagValues).toBe(1);
    await expect(remote.synchronizeDataset(base.id)).rejects.toMatchObject({
      name: "OsmixRemoteStateError",
      operation: "dataset replication",
    });
    await expect(remote.get(base.id)).rejects.toMatchObject({
      name: "OsmixRemoteStateError",
      operation: "dataset replication",
    });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does not mark a worker rejection as a committed mutation", async () => {
    const { base, patch } = inputs();
    using remote = new SyncFailureRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    let caught: unknown;
    try {
      await remote.applyChangesAndReplace(base.id);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toHaveProperty("committed");
    expect([...(await remote.get(base.id)).nodes.sorted()]).toEqual([...base.nodes.sorted()]);
  });
});
