import { describe, expect, it } from "vitest";

import {
  buildConflationActionDecision,
  conflationEffectiveStatus,
  Osm,
  type OsmConflationCandidate,
  type OsmConflationDecision,
  type OsmConflationResolvedActions,
  OsmixRemote,
  OsmixWorker,
  resolveConflationActions,
} from "../src/index";
import { RoutingTestHarness } from "./routing-harness";

const candidateId = "node:101->1";
const options = { propertyKeys: ["name"], attachNetwork: true };
const mergeOptions = { directMerge: true };
const candidateFilter = { entityType: "node" as const, sourceId: 101 };

function inputs(blockAttachment = false) {
  const base = new Osm({ id: "actions-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { name: "Base entrance" } });
  base.nodes.addNode({ id: 2, lon: -0.001, lat: 0 });
  base.nodes.buildIndex();
  base.ways.addWay({ id: 10, refs: [2, 1], tags: { highway: "footway" } });
  base.buildIndexes();
  base.buildSpatialIndexes();
  const patch = new Osm({ id: "actions-patch" });
  patch.nodes.addNode({
    id: 101,
    lon: 0.000005,
    lat: 0,
    tags: { name: "Imported entrance", ...(blockAttachment ? { barrier: "gate" } : {}) },
  });
  patch.nodes.addNode({ id: 102, lon: 0.001, lat: 0 });
  patch.nodes.buildIndex();
  patch.ways.addWay({ id: 20, refs: [101, 102], tags: { highway: "footway" } });
  patch.buildIndexes();
  patch.buildSpatialIndexes();
  return { base, patch };
}

class TestWorker extends OsmixWorker {
  setOsm(osm: Osm) {
    this.set(osm.id, osm);
  }

  getOsm(id: string) {
    return this.get(id);
  }
}

class RecoveryRemote extends OsmixRemote {
  async restartForTest() {
    const worker = this.getWorker();
    await worker.delete("actions-base");
    await worker.delete("actions-patch");
    await this.restorePoolWorker(worker, 0, 1);
  }
}

function setupWorker(blockAttachment = false) {
  const { base, patch } = inputs(blockAttachment);
  const worker = new TestWorker();
  worker.setOsm(base);
  worker.setOsm(patch);
  worker.discoverConflation(base.id, patch.id, options);
  worker.setConflationFilter(base.id, candidateFilter);
  return { worker, base, patch };
}

function requireCandidate(page: Awaited<ReturnType<OsmixRemote["getConflationPage"]>>) {
  const candidate = page.candidates.find((row) => row.id === candidateId);
  if (!candidate) throw Error("Expected entrance candidate");
  return candidate;
}

function expectPreview(
  preview: Awaited<ReturnType<OsmixRemote["getChangesetPage"]>>,
  actions: OsmConflationResolvedActions,
) {
  const baseNodeChange = preview.changes?.find(
    (change) => change.entity.id === 1 && "lon" in change.entity,
  );
  if (actions.transferProperties) {
    expect(baseNodeChange).toMatchObject({
      changeType: "modify",
      entity: { tags: { name: "Imported entrance" } },
    });
  } else expect(baseNodeChange).toBeUndefined();
  expect(preview.changes?.find((change) => change.entity.id === 20)).toMatchObject({
    changeType: "create",
    entity: { refs: actions.attachNetwork ? [1, 102] : [101, 102] },
  });
}

function expectResult(osm: Osm, base: Osm, patch: Osm, actions: OsmConflationResolvedActions) {
  const expectedNodes = [...base.nodes.sorted(), ...patch.nodes.sorted()].map((node) =>
    node.id === 1 && actions.transferProperties
      ? { ...node, tags: { ...node.tags, name: "Imported entrance" } }
      : node,
  );
  const expectedWays = [...base.ways.sorted(), ...patch.ways.sorted()].map((way) =>
    way.id === 20 && actions.attachNetwork ? { ...way, refs: [1, 102] } : way,
  );
  expect([...osm.nodes.sorted()]).toEqual(expectedNodes);
  expect([...osm.ways.sorted()]).toEqual(expectedWays);
  expect([...osm.relations.sorted()]).toEqual([]);
  const route = new RoutingTestHarness(osm).run({
    id: "entrance-connection",
    description: "Walk from the base sidewalk to the imported continuation",
    mode: "walk",
    metric: "distance",
    from: { nodeId: 2 },
    to: { nodeId: 102 },
    expect: { reachable: actions.attachNetwork },
  });
  expect(route.reachable).toBe(actions.attachNetwork);
  expect(route.algorithmAgreement).toBe(true);
  expect(route.path?.nodeIds ?? null).toEqual(actions.attachNetwork ? [2, 1, 102] : null);
}

const selections = [
  { name: "copy only", transferProperties: true, attachNetwork: false, action: "accept" },
  { name: "connect only", transferProperties: false, attachNetwork: true, action: "accept" },
  { name: "both", transferProperties: true, attachNetwork: true, action: "accept" },
  { name: "neither", transferProperties: false, attachNetwork: false, action: "accept" },
  { name: "reject", transferProperties: false, attachNetwork: false, action: "reject" },
] as const;

describe("scheduled conflation actions", () => {
  it.each(selections)(
    "preserves $name through paging, regeneration, and worker recovery",
    async (selection) => {
      const { base, patch } = inputs();
      using remote = new RecoveryRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      await remote.transferIn(base);
      await remote.transferIn(patch);
      await remote.discoverConflation(base.id, patch.id, options);
      await remote.setConflationFilter(base.id, candidateFilter);
      const candidate = requireCandidate(await remote.getConflationPage(base.id, 0, 1));
      expect(candidate.propertyTransfer.status).toBe("automatic");
      expect(candidate.networkAttachment?.status).toBe("automatic");
      const decision: OsmConflationDecision = {
        candidateId,
        action: selection.action,
        transferProperties: selection.transferProperties,
        attachNetwork: selection.attachNetwork,
      };
      const expected = {
        transferProperties: selection.transferProperties,
        attachNetwork: selection.attachNetwork,
      };
      await remote.setConflationDecision(base.id, decision);
      const status =
        expected.transferProperties || expected.attachNetwork ? "accepted" : "rejected";
      await remote.setConflationFilter(base.id, { ...candidateFilter, status });
      const saved = requireCandidate(await remote.getConflationPage(base.id, 0, 1));
      expect(saved.decision).toEqual(decision);
      expect(resolveConflationActions(saved, saved.decision)).toEqual(expected);
      expect(conflationEffectiveStatus(saved, [decision])).toBe(status);
      await remote.generateConflationChangeset(base.id, mergeOptions);
      const preview = await remote.getChangesetPage(base.id, 0, 100);
      expectPreview(preview, expected);
      await remote.generateConflationChangeset(base.id, mergeOptions);
      expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(preview);

      await remote.restartForTest();

      const restored = requireCandidate(await remote.getConflationPage(base.id, 0, 1));
      expect(restored.decision).toEqual(decision);
      expect(resolveConflationActions(restored, restored.decision)).toEqual(expected);
      expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(preview);
      await remote.applyChangesAndReplace(base.id);
      expectResult(await remote.get(base.id), base, patch, expected);
    },
  );

  it("preserves the other scheduled action while toggling and clears decisions back to automatic", () => {
    const { worker, base, patch } = setupWorker();
    const candidate = requireCandidate(worker.getConflationPage(base.id, 0, 1));
    let decision: OsmConflationDecision | undefined;
    for (const selection of [
      { action: "transfer-properties", selected: false, copy: false, connect: true },
      { action: "attach-network", selected: false, copy: false, connect: false },
      { action: "transfer-properties", selected: true, copy: true, connect: false },
      { action: "attach-network", selected: true, copy: true, connect: true },
    ] as const) {
      decision = buildConflationActionDecision(
        candidate,
        decision,
        selection.action,
        selection.selected,
      );
      worker.setConflationDecision(base.id, decision);
      const expected = { transferProperties: selection.copy, attachNetwork: selection.connect };
      const saved = requireCandidate(worker.getConflationPage(base.id, 0, 1));
      expect(resolveConflationActions(saved, saved.decision)).toEqual(expected);
      worker.generateConflationChangeset(base.id, mergeOptions);
      expectPreview(worker.getChangesetPage(base.id, 0, 100), expected);
    }
    worker.setConflationDecision(base.id, { candidateId, action: "reject" });
    worker.generateConflationChangeset(base.id, mergeOptions);
    expectPreview(worker.getChangesetPage(base.id, 0, 100), {
      transferProperties: false,
      attachNetwork: false,
    });
    worker.setConflationDecisions(base.id, []);
    expect(() => worker.getChangesetPage(base.id, 0, 100)).toThrow("No active changeset");
    const automatic = requireCandidate(worker.getConflationPage(base.id, 0, 1));
    expect(automatic.decision).toBeUndefined();
    expect(resolveConflationActions(automatic)).toEqual({
      transferProperties: true,
      attachNetwork: true,
    });
    worker.generateConflationChangeset(base.id, mergeOptions);
    worker.applyChangesAndReplace(base.id);
    expectResult(worker.getOsm(base.id), base, patch, {
      transferProperties: true,
      attachNetwork: true,
    });
  });

  it.each(["neither", "rejected", "connect-only"] as const)(
    "makes row and bulk copy choices equivalent from %s",
    (initial) => {
      const row = setupWorker();
      const bulk = setupWorker();
      const prior: OsmConflationDecision = {
        candidateId,
        action: initial === "rejected" ? "reject" : "accept",
        transferProperties: false,
        attachNetwork: initial === "connect-only",
      };
      row.worker.setConflationDecision(row.base.id, prior);
      bulk.worker.setConflationDecision(bulk.base.id, prior);
      const candidate = requireCandidate(row.worker.getConflationPage(row.base.id, 0, 1));
      row.worker.setConflationDecision(
        row.base.id,
        buildConflationActionDecision(candidate, prior, "transfer-properties", true),
      );
      const result = bulk.worker.applyConflationBulkDecision(bulk.base.id, {
        action: "transfer-properties",
        filter: candidateFilter,
      });
      expect(result.preview).toMatchObject({
        filteredCandidates: 1,
        eligibleCandidates: 1,
        changedCandidates: 1,
      });
      const expected = { transferProperties: true, attachNetwork: initial === "connect-only" };
      for (const { worker, base, patch } of [row, bulk]) {
        const saved = requireCandidate(worker.getConflationPage(base.id, 0, 1));
        expect(resolveConflationActions(saved, saved.decision)).toEqual(expected);
        worker.generateConflationChangeset(base.id, mergeOptions);
        expectPreview(worker.getChangesetPage(base.id, 0, 100), expected);
        worker.applyChangesAndReplace(base.id);
        expectResult(worker.getOsm(base.id), base, patch, expected);
      }
    },
  );

  it("keeps a blocked connection unscheduled while an eligible tag copy remains selected", () => {
    const { worker, base, patch } = setupWorker(true);
    const candidate: OsmConflationCandidate = requireCandidate(
      worker.getConflationPage(base.id, 0, 1),
    );
    expect(candidate.propertyTransfer.status).toBe("automatic");
    expect(candidate.networkAttachment?.status).toBe("blocked");
    worker.setConflationDecision(base.id, {
      candidateId,
      action: "accept",
      transferProperties: true,
      attachNetwork: true,
    });
    const saved = requireCandidate(worker.getConflationPage(base.id, 0, 1));
    const expected = { transferProperties: true, attachNetwork: false };
    expect(resolveConflationActions(saved, saved.decision)).toEqual(expected);
    worker.generateConflationChangeset(base.id, mergeOptions);
    expectPreview(worker.getChangesetPage(base.id, 0, 100), expected);
    worker.applyChangesAndReplace(base.id);
    expectResult(worker.getOsm(base.id), base, patch, expected);
  });
});
