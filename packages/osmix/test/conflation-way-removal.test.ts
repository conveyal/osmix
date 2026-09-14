import { describe, expect, it } from "vitest";

import {
  buildConflationActionDecision,
  discoverConflationCandidates,
  fromPbf,
  generateConflationArtifacts,
  Osm,
  type OsmConflationDecision,
  type OsmConflationOptions,
  OsmixRemote,
  OsmixWorker,
  resolveConflationActions,
  toPbfBuffer,
} from "../src/index";

const wayCandidateId = "way:20->10";
const removalOptions: OsmConflationOptions = {
  propertyKeys: [],
  attachNetwork: false,
  allowWayRemoval: true,
};
const removeDecision: OsmConflationDecision = {
  candidateId: wayCandidateId,
  action: "accept",
  transferProperties: false,
  attachNetwork: false,
  removeWay: true,
};
const branchAttachment: OsmConflationDecision = {
  candidateId: "node:102->2",
  action: "accept",
  transferProperties: false,
  attachNetwork: true,
};

function inputs({
  branch = false,
  taggedNode = false,
  taggedBranch = false,
  extraContender = false,
} = {}) {
  const base = new Osm({ id: "removal-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0 });
  base.nodes.addNode({ id: 2, lon: 0.001, lat: 0 });
  base.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "footway", name: "Base trunk" } });
  const patch = new Osm({ id: "removal-patch" });
  patch.nodes.addNode({
    id: 101,
    lon: 0,
    lat: 0.000004,
    ...(taggedNode ? { tags: { name: "Retained marker" } } : {}),
  });
  patch.nodes.addNode({
    id: 102,
    lon: 0.001,
    lat: 0.000004,
    ...(taggedBranch ? { tags: { name: "Branch connection" } } : {}),
  });
  // An unrelated unreferenced import must not be swept up by orphan cleanup.
  patch.nodes.addNode({ id: 103, lon: 0.002, lat: 0.000004 });
  patch.ways.addWay({
    id: 20,
    refs: [101, 102],
    tags: { highway: "footway", name: "Imported trunk" },
  });
  if (branch) patch.ways.addWay({ id: 30, refs: [102, 103], tags: { highway: "footway" } });
  if (extraContender) {
    patch.nodes.addNode({ id: 201, lon: 0, lat: 0.000003 });
    patch.nodes.addNode({ id: 202, lon: -0.001, lat: 0.000003 });
    patch.ways.addWay({ id: 40, refs: [201, 202], tags: { highway: "footway" } });
  }
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
    await worker.delete("removal-base");
    await worker.delete("removal-patch");
    await this.restorePoolWorker(worker, 0, 1);
  }
}

function workerFor(base: Osm, patch: Osm, options: OsmConflationOptions = removalOptions) {
  const worker = new TestWorker();
  worker.add(base);
  worker.add(patch);
  worker.discoverConflation(base.id, patch.id, options);
  return worker;
}

function wayCandidate(worker: TestWorker, baseId: string) {
  const candidate = worker
    .getConflationPage(baseId, 0, 100)
    .candidates.find((candidate) => candidate.id === wayCandidateId);
  if (!candidate) throw Error("Expected removal candidate");
  return candidate;
}

describe("explicit way removal through the facade and worker", () => {
  it("keeps imported geometry for existing property-only callers", () => {
    const { base, patch } = inputs();
    const artifacts = generateConflationArtifacts(base, patch, {
      directMerge: true,
      conflation: { propertyKeys: ["name"], attachNetwork: false },
    });
    expect(artifacts.result.ways.getById(10)?.tags?.["name"]).toBe("Imported trunk");
    expect(artifacts.result.ways.getById(20)).toEqual(patch.ways.getById(20));
    expect([...artifacts.result.nodes.sorted()]).toEqual([
      ...base.nodes.sorted(),
      ...patch.nodes.sorted(),
    ]);
  });

  it("enables removal review without selecting removal automatically", () => {
    const { base, patch } = inputs();
    const options = { propertyKeys: ["name"], attachNetwork: false, allowWayRemoval: true };
    const discovery = discoverConflationCandidates(base, patch, options);
    const candidate = discovery.candidates.find((candidate) => candidate.id === wayCandidateId);
    expect(candidate).toMatchObject({ wayRemoval: { status: "review" } });
    if (!candidate) throw Error("Expected imported trunk candidate");
    expect(resolveConflationActions(candidate)).not.toHaveProperty("removeWay");
    expect(
      resolveConflationActions(candidate, { candidateId: wayCandidateId, action: "accept" }),
    ).not.toHaveProperty("removeWay");
    const generated = generateConflationArtifacts(base, patch, {
      directMerge: true,
      conflation: options,
    });
    expect(generated.result.ways.getById(20)).toEqual(patch.ways.getById(20));
  });

  it("supports removal alone and cleans only newly orphaned imported nodes", async () => {
    const { base, patch } = inputs();
    const options = { propertyKeys: [], attachNetwork: false, allowWayRemoval: true };
    const decision = {
      candidateId: wayCandidateId,
      action: "accept" as const,
      transferProperties: false,
      attachNetwork: false,
      removeWay: true,
    };
    const generated = generateConflationArtifacts(
      base,
      patch,
      {
        directMerge: true,
        conflation: { ...options, decisions: [decision] },
      },
      [decision],
    );
    expect([...generated.result.ways.sorted()]).toEqual([...base.ways.sorted()]);
    expect([...generated.result.nodes.sorted()]).toEqual([
      ...base.nodes.sorted(),
      patch.nodes.getById(103),
    ]);
    expect(generated.outcome.features.find((feature) => feature.sourceId === 20)).toMatchObject({
      targetId: 10,
      retained: false,
      skipped: false,
    });
    expect(generated.outcome.summary.appliedFeatures).toBe(1);
    const reloaded = await fromPbf(await toPbfBuffer(generated.result), { id: "removal-reloaded" });
    expect(entities(reloaded)).toEqual(entities(generated.result));
  });

  it("detaches candidate previews and retains tagged and unrelated imported nodes", () => {
    const { base, patch } = inputs({ taggedNode: true });
    const worker = workerFor(base, patch);
    const original = wayCandidate(worker, base.id);
    expect(original.wayRemoval).toMatchObject({
      status: "review",
      preview: {
        sourceWayId: 20,
        retainedWayId: 10,
        orphanNodeIds: [102],
        retainedTaggedNodeIds: [101],
        blockedNodeIds: [],
        blockingRelationIds: [],
      },
    });
    const preview = original.wayRemoval?.preview;
    if (!preview) throw Error("Expected removal preview");
    preview.orphanNodeIds.push(1, 103);
    preview.retainedTaggedNodeIds.length = 0;
    preview.sourceTags["highway"] = "motorway";
    expect(wayCandidate(worker, base.id).wayRemoval?.preview).toMatchObject({
      orphanNodeIds: [102],
      retainedTaggedNodeIds: [101],
      sourceTags: { highway: "footway" },
    });
    worker.setConflationDecision(base.id, removeDecision);
    const generated = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(generated.outcome.summary).toMatchObject({
      appliedFeatures: 1,
      wayRemovalActions: 1,
      removedOrphanNodes: 1,
      skippedFeatures: 0,
    });
    expect(
      generated.outcome.features.find((feature) => feature.sourceId === 20)?.wayRemoval,
    ).toMatchObject({ orphanNodeIds: [102], retainedTaggedNodeIds: [101] });
    expect(worker.getOsm(base.id).ways.ids.has(10)).toBe(true);
    expect(worker.getOsm(patch.id).ways.ids.has(20)).toBe(true);
    worker.applyChangesAndReplace(base.id);
    const result = worker.getOsm(base.id);
    expect([...result.ways.sorted()]).toEqual([...base.ways.sorted()]);
    expect(result.nodes.getById(101)).toEqual(patch.nodes.getById(101));
    expect(result.nodes.getById(103)).toEqual(patch.nodes.getById(103));
    expect(result.nodes.ids.has(102)).toBe(false);
  });

  it("requires explicit branch connections and refreshes assessments before saving decisions", async () => {
    const { base, patch } = inputs({ branch: true });
    const worker = workerFor(base, patch, {
      ...removalOptions,
      attachNetwork: true,
      automatic: "none",
    });
    expect(wayCandidate(worker, base.id).wayRemoval).toMatchObject({
      status: "blocked",
      preview: { blockedNodeIds: [102] },
    });
    const beforeBlocked = worker.getConflationPage(base.id, 0, 100);
    const ordinaryPreview = worker.generateConflationChangeset(base.id, { directMerge: true });
    const ordinaryChanges = worker.getChangesetPage(base.id, 0, 100);
    expect(() => worker.setConflationDecision(base.id, removeDecision)).toThrow();
    expect(worker.getConflationPage(base.id, 0, 100)).toEqual(beforeBlocked);
    expect(worker.getChangesetPage(base.id, 0, 100)).toEqual(ordinaryChanges);
    expect(ordinaryPreview.outcome.summary.wayRemovalActions).toBeUndefined();

    worker.setConflationDecision(base.id, branchAttachment);
    const candidate = wayCandidate(worker, base.id);
    expect(candidate.wayRemoval).toMatchObject({
      status: "review",
      preview: {
        blockedNodeIds: [],
        connections: [
          {
            sourceNodeId: 102,
            targetNodeId: 2,
            retainedWayIds: [30],
            attachmentCandidateId: "node:102->2",
            explicitlyAccepted: true,
          },
        ],
      },
    });
    candidate.wayRemoval!.preview!.connections[0]!.retainedWayIds.push(999);
    expect(
      wayCandidate(worker, base.id).wayRemoval?.preview?.connections[0]?.retainedWayIds,
    ).toEqual([30]);
    worker.setConflationSourceDecision(
      base.id,
      { entityType: "way", sourceId: 20 },
      removeDecision,
    );
    const generated = worker.generateConflationChangeset(base.id, { directMerge: true });
    const removal = generated.outcome.features.find(
      (feature) => feature.sourceId === 20,
    )?.wayRemoval;
    expect(removal).toMatchObject({
      sourceWayId: 20,
      retainedWayId: 10,
      orphanNodeIds: [101],
      connections: [
        { sourceNodeId: 102, targetNodeId: 2, retainedWayIds: [30], explicitlyAccepted: true },
      ],
    });
    const page = worker.getConflationPage(base.id, 0, 100);
    const changes = worker.getChangesetPage(base.id, 0, 100);
    const rejectedAttachment = { ...branchAttachment, action: "reject" as const };
    for (const mutate of [
      () => worker.setConflationDecision(base.id, rejectedAttachment),
      () => worker.setConflationDecisions(base.id, [removeDecision]),
      () =>
        worker.setConflationSourceDecision(base.id, { entityType: "node", sourceId: 102 }, null),
      () =>
        worker.applyConflationBulkDecision(base.id, {
          action: "reject",
          filter: { entityType: "node", sourceId: 102 },
        }),
    ]) {
      expect(mutate).toThrow();
      expect(worker.getConflationPage(base.id, 0, 100)).toEqual(page);
      expect(worker.getChangesetPage(base.id, 0, 100)).toEqual(changes);
    }
    worker.applyChangesAndReplace(base.id);
    const result = worker.getOsm(base.id);
    expect(result.ways.ids.has(20)).toBe(false);
    expect(result.ways.getById(10)).toEqual(base.ways.getById(10));
    expect(result.ways.getById(30)?.refs).toEqual([2, 103]);
    expect(result.nodes.ids.has(101)).toBe(false);
    expect(result.nodes.ids.has(102)).toBe(true);
    const reloaded = await fromPbf(await toPbfBuffer(result), { id: "branch-reloaded" });
    expect(entities(reloaded)).toEqual(entities(result));
  });

  it("keeps automatic attachments insufficient to approve branch removal", () => {
    const { base, patch } = inputs({ branch: true });
    const worker = workerFor(base, patch, { ...removalOptions, attachNetwork: true });
    expect(wayCandidate(worker, base.id).wayRemoval?.status).toBe("blocked");
    expect(() => worker.setConflationDecision(base.id, removeDecision)).toThrow();
    const generated = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(generated.outcome.summary.wayRemovalActions).toBeUndefined();
    expect(wayCandidate(worker, base.id).wayRemoval?.status).toBe("blocked");
  });

  it.each(["row", "bulk"] as const)(
    "does not treat %s tag copying as explicit branch-connection confirmation",
    (mode) => {
      const { base, patch } = inputs({ branch: true, taggedBranch: true });
      const worker = workerFor(base, patch, {
        ...removalOptions,
        propertyKeys: ["name"],
        attachNetwork: true,
      });
      const connectionCandidate = () => {
        const candidate = worker
          .getConflationPage(base.id, 0, 100)
          .candidates.find((candidate) => candidate.id === branchAttachment.candidateId);
        if (!candidate) throw Error("Expected branch connection candidate");
        return candidate;
      };
      expect(connectionCandidate().networkAttachment?.status).toBe("automatic");
      expect(resolveConflationActions(connectionCandidate())).toMatchObject({
        transferProperties: true,
        attachNetwork: true,
      });
      if (mode === "row") {
        for (const selected of [false, true]) {
          const candidate = connectionCandidate();
          worker.setConflationSourceDecision(
            base.id,
            { entityType: "node", sourceId: 102 },
            buildConflationActionDecision(
              candidate,
              candidate.decision,
              "transfer-properties",
              selected,
            ),
          );
          expect(connectionCandidate().decision?.attachNetwork).toBeUndefined();
          expect(wayCandidate(worker, base.id).wayRemoval?.status).toBe("blocked");
        }
      } else {
        const result = worker.applyConflationBulkDecision(base.id, {
          action: "transfer-properties",
          filter: { entityType: "node", sourceId: 102 },
        });
        expect(result.preview).toMatchObject({ eligibleCandidates: 1, changedCandidates: 1 });
      }
      const copied = connectionCandidate();
      expect(copied.decision).toMatchObject({ action: "accept", transferProperties: true });
      expect(copied.decision?.attachNetwork).toBeUndefined();
      expect(resolveConflationActions(copied, copied.decision).attachNetwork).toBe(true);
      expect(wayCandidate(worker, base.id).wayRemoval).toMatchObject({
        status: "blocked",
        preview: { connections: [{ explicitlyAccepted: false }] },
      });
      expect(() => worker.setConflationDecision(base.id, removeDecision)).toThrow();

      if (mode === "row") {
        worker.setConflationSourceDecision(
          base.id,
          { entityType: "node", sourceId: 102 },
          buildConflationActionDecision(copied, copied.decision, "attach-network", true),
        );
      } else {
        const result = worker.applyConflationBulkDecision(base.id, {
          action: "attach-network",
          filter: { entityType: "node", sourceId: 102 },
        });
        expect(result.preview).toMatchObject({ eligibleCandidates: 1, changedCandidates: 1 });
      }
      expect(connectionCandidate().decision?.attachNetwork).toBe(true);
      expect(wayCandidate(worker, base.id).wayRemoval).toMatchObject({
        status: "review",
        preview: { connections: [{ explicitlyAccepted: true }] },
      });
      worker.setConflationDecision(base.id, removeDecision);
      const generated = worker.generateConflationChangeset(base.id, { directMerge: true });
      expect(generated.outcome.summary.wayRemovalActions).toBe(1);
      worker.applyChangesAndReplace(base.id);
      const result = worker.getOsm(base.id);
      expect(result.ways.ids.has(20)).toBe(false);
      expect(result.ways.getById(30)?.refs).toEqual([2, 103]);
      expect(result.nodes.getById(2)?.tags?.["name"]).toBe("Branch connection");
    },
  );

  it("restores assessment changes when a later aggregate mapping check rejects a decision set", () => {
    const { base, patch } = inputs({ branch: true, extraContender: true });
    const worker = workerFor(base, patch, {
      ...removalOptions,
      attachNetwork: true,
      automatic: "none",
    });
    worker.setConflationDecisions(base.id, [branchAttachment, removeDecision]);
    worker.generateConflationChangeset(base.id, { directMerge: true });
    const page = worker.getConflationPage(base.id, 0, 100);
    const changes = worker.getChangesetPage(base.id, 0, 100);
    expect(() =>
      worker.setConflationDecisions(base.id, [
        { ...branchAttachment, candidateId: "node:101->1" },
        { ...branchAttachment, candidateId: "node:201->1" },
      ]),
    ).toThrow(/multiple node attachments/);
    expect(worker.getConflationPage(base.id, 0, 100)).toEqual(page);
    expect(worker.getChangesetPage(base.id, 0, 100)).toEqual(changes);
    expect(wayCandidate(worker, base.id).wayRemoval?.status).toBe("review");
  });

  it("rejects removal when disabled without discarding an existing generated preview", () => {
    const { base, patch } = inputs();
    const worker = workerFor(base, patch, { propertyKeys: ["name"], attachNetwork: false });
    worker.generateConflationChangeset(base.id, { directMerge: true });
    const page = worker.getConflationPage(base.id, 0, 100);
    const changes = worker.getChangesetPage(base.id, 0, 100);
    expect(() => worker.setConflationDecision(base.id, removeDecision)).toThrow(/not enabled/);
    expect(worker.getConflationPage(base.id, 0, 100)).toEqual(page);
    expect(worker.getChangesetPage(base.id, 0, 100)).toEqual(changes);
  });

  it("recovers removal choices, page evidence and generated outcomes without sharing mutable reports", async () => {
    const { base, patch } = inputs({ branch: true });
    const options: OsmConflationOptions = {
      ...removalOptions,
      attachNetwork: true,
      automatic: "none",
    };
    using remote = new RecoveryRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    await remote.discoverConflation(base.id, patch.id, options);
    options.allowWayRemoval = false;
    await remote.setConflationDecision(base.id, branchAttachment);
    await remote.setConflationSourceDecision(
      base.id,
      { entityType: "way", sourceId: 20 },
      removeDecision,
    );
    await remote.setConflationFilter(base.id, { entityType: "way", sourceId: 20 });
    const page = await remote.getConflationPage(base.id, 0, 1, { groupBySource: true });
    const generated = await remote.generateConflationChangeset(base.id, { directMerge: true });
    const expectedOutcome = structuredClone(generated.outcome);
    const changes = await remote.getChangesetPage(base.id, 0, 100);
    await expect(
      remote.setConflationDecision(base.id, {
        ...branchAttachment,
        action: "reject",
      }),
    ).rejects.toThrow();
    const mutable = generated.outcome.features.find(
      (feature) => feature.sourceId === 20,
    )?.wayRemoval;
    if (!mutable) throw Error("Expected generated removal report");
    mutable.orphanNodeIds.push(103);
    mutable.connections[0]!.retainedWayIds.length = 0;
    await remote.restartForTest();
    expect(await remote.getConflationPage(base.id, 0, 1, { groupBySource: true })).toEqual(page);
    expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(changes);
    const recovered = await remote.generateConflationChangeset(base.id, { directMerge: true });
    expect(recovered.outcome).toEqual(expectedOutcome);
    await remote.applyChangesAndReplace(base.id);
    const result = await remote.get(base.id);
    expect(result.ways.ids.has(20)).toBe(false);
    expect(result.ways.getById(30)?.refs).toEqual([2, 103]);
    expect(recovered.outcome).toEqual(expectedOutcome);
    await expect(remote.getConflationSummary(base.id)).rejects.toThrow();
  });

  it("invalidates removal review and previews when an input is replaced under the same ID", async () => {
    const { base, patch } = inputs();
    using remote = new RecoveryRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    await remote.discoverConflation(base.id, patch.id, removalOptions);
    await remote.setConflationDecision(base.id, removeDecision);
    await remote.generateConflationChangeset(base.id, { directMerge: true });
    const replacement = inputs({ branch: true }).patch;
    await remote.transferIn(replacement);
    await expect(remote.getConflationPage(base.id, 0, 100)).rejects.toThrow();
    await expect(remote.applyChangesAndReplace(base.id)).rejects.toThrow();
    await remote.restartForTest();
    await expect(remote.getConflationPage(base.id, 0, 100)).rejects.toThrow();
    expect(entities(await remote.get(base.id))).toEqual(entities(base));
    expect((await remote.get(patch.id)).ways.getById(30)?.refs).toEqual([102, 103]);
  });
});
