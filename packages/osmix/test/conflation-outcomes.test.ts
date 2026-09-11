import { describe, expect, it } from "vitest";

import {
  applyChangesetToOsm,
  generateConflationArtifacts,
  Osm,
  type OsmConflationOptions,
  type OsmConflationOutcomeReport,
  type OsmNode,
  OsmixRemote,
  OsmixWorker,
} from "../src/index";

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
    await worker.delete("outcomes-base");
    await worker.delete("outcomes-patch");
    await this.restorePoolWorker(worker, 0, 1);
  }
}

function finish(base: Osm, patch: Osm, options: OsmConflationOptions) {
  for (const osm of [base, patch]) {
    osm.buildIndexes();
    osm.buildSpatialIndexes();
  }
  const worker = new TestWorker();
  worker.add(base);
  worker.add(patch);
  worker.discoverConflation(base.id, patch.id, options);
  return { base, patch, worker, options };
}

function propertyInputs(mode: "applied" | "mixed" | "zero") {
  const base = new Osm({ id: "outcomes-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { tactile_paving: "no" } });
  const patch = new Osm({ id: "outcomes-patch" });
  patch.nodes.addNode({
    id: 101,
    lon: 0.000005,
    lat: 0,
    tags: mode === "zero" ? { name: "Unselected attribute" } : { tactile_paving: "yes" },
  });
  if (mode === "mixed") {
    const baseNodes: OsmNode[] = [
      { id: 2, lon: 0.009997, lat: 0 },
      { id: 3, lon: 0.010003, lat: 0 },
      { id: 4, lon: 0.02, lat: 0, tags: { tactile_paving: "no" } },
      { id: 5, lon: 0.03, lat: 0, tags: { layer: "0" } },
    ];
    for (const node of baseNodes) base.nodes.addNode(node);
    const patchNodes: OsmNode[] = [
      { id: 201, lon: 0.01, lat: 0, tags: { tactile_paving: "yes" } },
      { id: 301, lon: 0.020005, lat: 0, tags: { tactile_paving: "yes" } },
      { id: 401, lon: 0.030005, lat: 0, tags: { layer: "1" } },
      { id: 501, lon: 0.05, lat: 0, tags: { tactile_paving: "yes" } },
    ];
    for (const node of patchNodes) patch.nodes.addNode(node);
  }
  return finish(base, patch, {
    propertyKeys: ["tactile_paving", "layer", "missing-key"],
    attachNetwork: false,
  });
}

function networkInputs() {
  const base = new Osm({ id: "outcomes-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { tactile_paving: "no" } });
  base.nodes.addNode({ id: 2, lon: 0.001, lat: 0, tags: { tactile_paving: "no" } });
  base.nodes.buildIndex();
  base.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "footway" } });
  const patch = new Osm({ id: "outcomes-patch" });
  patch.nodes.addNode({ id: 101, lon: 0, lat: 0.000005, tags: { tactile_paving: "yes" } });
  patch.nodes.addNode({ id: 102, lon: 0.001, lat: 0.000005, tags: { tactile_paving: "yes" } });
  patch.nodes.buildIndex();
  patch.ways.addWay({ id: 20, refs: [101, 102], tags: { highway: "footway" } });
  return finish(base, patch, { propertyKeys: ["tactile_paving"], attachNetwork: true });
}

describe("conflation generation outcomes", () => {
  it("counts actual copied values and retains the report after applying a fully matched import", () => {
    const { worker, base } = propertyInputs("applied");
    const generated = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(generated.outcome.summary).toEqual(
      summary({ features: 1, appliedFeatures: 1, tagCopyActions: 1, copiedTagValues: 1 }),
    );
    expect(generated.outcome.tags.find((tag) => tag.key === "tactile_paving")).toMatchObject({
      presentFeatures: 1,
      copiedFeatures: 1,
      alreadyEqualFeatures: 0,
      uncopied: [],
    });
    expect(generated.outcome.features).toEqual([
      expect.objectContaining({
        entityType: "node",
        sourceId: 101,
        targetId: 1,
        copiedKeys: ["tactile_paving"],
        connectedWayIds: [],
        unresolved: null,
        skipped: false,
        retained: true,
        ordinaryAddition: true,
      }),
    ]);
    expect(generated.outcome.retainedImports).toEqual({
      originalIds: { nodes: 1, ways: 0, relations: 0 },
      ordinaryAdditions: { nodes: 1, ways: 0, relations: 0 },
    });
    const saved = structuredClone(generated.outcome);
    worker.applyChangesAndReplace(base.id);
    expect(worker.getOsm(base.id).nodes.getById(1)?.tags?.["tactile_paving"]).toBe("yes");
    expect(worker.getOsm(base.id).nodes.getById(101)?.tags?.["tactile_paving"]).toBe("yes");
    expect(() => worker.getConflationSummary(base.id)).toThrow();
    expect(generated.outcome).toEqual(saved);
  });

  it("separates mixed outcomes by imported feature and identifies uncopied selected tags", () => {
    const { worker, base, patch } = propertyInputs("mixed");
    worker.setConflationDecision(base.id, { candidateId: "node:301->4", action: "reject" });
    const { outcome } = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(outcome.summary).toEqual(
      summary({
        features: 5,
        appliedFeatures: 1,
        tagCopyActions: 1,
        copiedTagValues: 1,
        unresolvedFeatures: 3,
        ambiguousFeatures: 1,
        blockedFeatures: 1,
        unmatchedFeatures: 1,
        skippedFeatures: 1,
      }),
    );
    expect(outcome.features.find((feature) => feature.sourceId === 201)).toMatchObject({
      candidateIds: ["node:201->2", "node:201->3"],
      targetId: null,
      unresolved: "ambiguous",
      retained: true,
    });
    expect(outcome.features.find((feature) => feature.sourceId === 301)).toMatchObject({
      skipped: true,
      unresolved: null,
      copiedKeys: [],
      ordinaryAddition: true,
    });
    expect(outcome.features.find((feature) => feature.sourceId === 401)).toMatchObject({
      unresolved: "blocked",
      reasons: expect.arrayContaining(["protected-tag"]),
      retained: true,
    });
    const tactile = outcome.tags.find((tag) => tag.key === "tactile_paving");
    expect(tactile).toMatchObject({
      presentFeatures: 4,
      copiedFeatures: 1,
      alreadyEqualFeatures: 0,
    });
    expect(tactile?.uncopied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "node",
          sourceId: 201,
          reason: "no-accepted-target",
        }),
        expect.objectContaining({ entityType: "node", sourceId: 301, reason: "not-selected" }),
        expect.objectContaining({
          entityType: "node",
          sourceId: 501,
          reason: "no-accepted-target",
        }),
      ]),
    );
    expect(tactile?.uncopied).toHaveLength(3);
    const protectedTag = outcome.tags.find((tag) => tag.key === "layer");
    expect(protectedTag).toMatchObject({
      presentFeatures: 1,
      copiedFeatures: 0,
      alreadyEqualFeatures: 0,
    });
    expect(protectedTag?.uncopied).toEqual([
      expect.objectContaining({
        entityType: "node",
        sourceId: 401,
        reason: expect.stringMatching(/^(blocked|protected-tag)$/),
      }),
    ]);
    expect(outcome.tags.find((tag) => tag.key === "missing-key")?.uncopied ?? []).toEqual([]);
    expect(outcome.retainedImports).toEqual({
      originalIds: { nodes: 5, ways: 0, relations: 0 },
      ordinaryAdditions: { nodes: 5, ways: 0, relations: 0 },
    });
    worker.applyChangesAndReplace(base.id);
    const actual = worker.getOsm(base.id);
    expect([...actual.nodes.sorted()]).toEqual(
      [...base.nodes.sorted(), ...patch.nodes.sorted()].map((node) =>
        node.id === 1 ? { ...node, tags: { tactile_paving: "yes" } } : node,
      ),
    );
    expect([...actual.ways.sorted()]).toEqual([]);
    expect([...actual.relations.sorted()]).toEqual([]);
  });

  it("reports an all-unresolved review without claiming its imported attributes were copied", () => {
    const { worker, base, patch, options } = propertyInputs("applied");
    worker.discoverConflation(base.id, patch.id, { ...options, automatic: "none" });
    const { outcome } = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(outcome.summary).toEqual(
      summary({ features: 1, unresolvedFeatures: 1, reviewFeatures: 1 }),
    );
    expect(outcome.tags.find((tag) => tag.key === "tactile_paving")?.uncopied).toEqual([
      expect.objectContaining({ entityType: "node", sourceId: 101, reason: "no-accepted-target" }),
    ]);
    worker.applyChangesAndReplace(base.id);
    expect([...worker.getOsm(base.id).nodes.sorted()]).toEqual([
      ...base.nodes.sorted(),
      ...patch.nodes.sorted(),
    ]);
  });

  it("reports zero candidates while preserving the ordinary import", () => {
    const { worker, base, patch } = propertyInputs("zero");
    const { outcome } = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(outcome.summary).toEqual(summary());
    expect(outcome.features).toEqual([]);
    expect(outcome.tags.every((tag) => tag.uncopied.length === 0)).toBe(true);
    expect(outcome.retainedImports).toEqual({
      originalIds: { nodes: 1, ways: 0, relations: 0 },
      ordinaryAdditions: { nodes: 1, ways: 0, relations: 0 },
    });
    worker.applyChangesAndReplace(base.id);
    expect([...worker.getOsm(base.id).nodes.sorted()]).toEqual([
      ...base.nodes.sorted(),
      ...patch.nodes.sorted(),
    ]);
  });

  it("reports actual public and worker network changes and survives recovery and application", async () => {
    const { base, patch, options, worker } = networkInputs();
    const publicArtifacts = generateConflationArtifacts(base, patch, {
      directMerge: true,
      conflation: options,
    });
    const publicResult = applyChangesetToOsm(publicArtifacts.changeset);
    const generated = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(generated.outcome).toEqual(publicArtifacts.outcome);
    expect(generated.outcome.summary).toEqual(
      summary({
        features: 2,
        appliedFeatures: 2,
        tagCopyActions: 2,
        copiedTagValues: 2,
        networkAttachmentActions: 2,
      }),
    );
    expect(generated.outcome.features.map((feature) => feature.connectedWayIds)).toEqual([
      [20],
      [20],
    ]);
    expect(generated.outcome.retainedImports).toEqual({
      originalIds: { nodes: 2, ways: 1, relations: 0 },
      ordinaryAdditions: { nodes: 2, ways: 1, relations: 0 },
    });
    expect(publicResult.ways.getById(20)?.refs).toEqual([1, 2]);
    expect(publicResult.nodes.getById(1)?.tags?.["tactile_paving"]).toBe("yes");
    expect(publicResult.nodes.getById(2)?.tags?.["tactile_paving"]).toBe("yes");

    using remote = new RecoveryRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    await remote.discoverConflation(base.id, patch.id, options);
    const run = await remote.generateConflationChangeset(base.id, { directMerge: true });
    expect(run.outcome).toEqual(generated.outcome);
    const retained = structuredClone(run.outcome);
    const preview = await remote.getChangesetPage(base.id, 0, 100);
    await remote.restartForTest();
    expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(preview);
    expect(
      (await remote.generateConflationChangeset(base.id, { directMerge: true })).outcome,
    ).toEqual(retained);
    await remote.applyChangesAndReplace(base.id);
    const actual = await remote.get(base.id);
    expect([...actual.nodes.sorted()]).toEqual([...publicResult.nodes.sorted()]);
    expect([...actual.ways.sorted()]).toEqual([...publicResult.ways.sorted()]);
    expect([...actual.relations.sorted()]).toEqual([...publicResult.relations.sorted()]);
    expect(run.outcome).toEqual(retained);
    await expect(remote.getConflationSummary(base.id)).rejects.toThrow();
  });

  it("detaches reports from review data and recomputes totals when a different target is selected", () => {
    const { worker, base } = propertyInputs("mixed");
    worker.setConflationDecision(base.id, { candidateId: "node:301->4", action: "reject" });
    const first = worker.generateConflationChangeset(base.id, { directMerge: true });
    const original = structuredClone(first.outcome);
    const page = worker.getConflationPage(base.id, 0, 100);
    first.outcome.summary.copiedTagValues = 999;
    first.outcome.features[0]!.candidateIds.push("not-a-canonical-candidate");
    first.outcome.features[0]!.reasons.push("geometry-mismatch");
    first.outcome.tags[0]!.uncopied.length = 0;
    expect(worker.getConflationPage(base.id, 0, 100)).toEqual(page);
    expect(worker.generateConflationChangeset(base.id, { directMerge: true }).outcome).toEqual(
      original,
    );
    worker.setConflationSourceDecision(
      base.id,
      { entityType: "node", sourceId: 201 },
      {
        candidateId: "node:201->2",
        action: "accept",
        transferProperties: true,
        attachNetwork: false,
      },
    );
    const revised = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(revised.outcome.summary).toEqual(
      summary({
        features: 5,
        appliedFeatures: 2,
        tagCopyActions: 2,
        copiedTagValues: 2,
        unresolvedFeatures: 2,
        blockedFeatures: 1,
        unmatchedFeatures: 1,
        skippedFeatures: 1,
      }),
    );
    expect(
      revised.outcome.tags
        .find((tag) => tag.key === "tactile_paving")
        ?.uncopied.map((entry) => entry.sourceId),
    ).toEqual([301, 501]);
    worker.applyChangesAndReplace(base.id);
    expect(worker.getOsm(base.id).nodes.getById(2)?.tags?.["tactile_paving"]).toBe("yes");
    expect(worker.getOsm(base.id).nodes.getById(3)?.tags?.["tactile_paving"]).toBeUndefined();
  });

  it("does not count a scheduled tag copy that another imported value supersedes", () => {
    const base = new Osm({ id: "outcomes-base" });
    base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { name: "Base entrance" } });
    const patch = new Osm({ id: "outcomes-patch" });
    patch.nodes.addNode({ id: 101, lon: -0.000003, lat: 0, tags: { name: "First import" } });
    patch.nodes.addNode({ id: 102, lon: 0.000003, lat: 0, tags: { name: "Second import" } });
    const { worker } = finish(base, patch, { propertyKeys: ["name"], attachNetwork: false });
    worker.setConflationDecisions(base.id, [
      { candidateId: "node:101->1", action: "accept" },
      { candidateId: "node:102->1", action: "accept" },
    ]);
    expect(worker.getConflationSummary(base.id).accepted).toBe(2);
    const { outcome } = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(outcome.summary).toMatchObject({
      features: 2,
      appliedFeatures: 1,
      tagCopyActions: 1,
      copiedTagValues: 1,
      networkAttachmentActions: 0,
    });
    expect(outcome.tags).toEqual([
      {
        key: "name",
        presentFeatures: 2,
        copiedFeatures: 1,
        alreadyEqualFeatures: 0,
        satisfiedByOtherCopyFeatures: 0,
        uncopied: [
          expect.objectContaining({ entityType: "node", sourceId: 101, reason: "superseded" }),
        ],
      },
    ]);
    worker.applyChangesAndReplace(base.id);
    expect(worker.getOsm(base.id).nodes.getById(1)?.tags?.["name"]).toBe("Second import");
    expect(worker.getOsm(base.id).nodes.getById(101)?.tags?.["name"]).toBe("First import");
  });

  it("distinguishes an already equal selected value from a newly copied value", () => {
    const base = new Osm({ id: "outcomes-base" });
    base.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { tactile_paving: "yes" } });
    const patch = new Osm({ id: "outcomes-patch" });
    patch.nodes.addNode({ id: 101, lon: 0.000005, lat: 0, tags: { tactile_paving: "yes" } });
    const { worker } = finish(base, patch, {
      propertyKeys: ["tactile_paving"],
      attachNetwork: false,
    });
    const { outcome } = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(outcome.summary.tagCopyActions).toBe(0);
    expect(outcome.summary.copiedTagValues).toBe(0);
    expect(outcome.tags).toEqual([
      {
        key: "tactile_paving",
        presentFeatures: 1,
        copiedFeatures: 0,
        alreadyEqualFeatures: 1,
        satisfiedByOtherCopyFeatures: 0,
        uncopied: [],
      },
    ]);
    worker.applyChangesAndReplace(base.id);
    expect([...worker.getOsm(base.id).nodes.sorted()]).toEqual([
      ...base.nodes.sorted(),
      ...patch.nodes.sorted(),
    ]);
  });

  it("reports uncopied selected attributes when a reviewed feature only connects the network", () => {
    const { worker, base } = networkInputs();
    worker.setConflationDecisions(base.id, [
      {
        candidateId: "node:101->1",
        action: "accept",
        transferProperties: false,
        attachNetwork: true,
      },
      { candidateId: "node:102->2", action: "reject" },
    ]);
    const { outcome } = worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(outcome.summary).toMatchObject({
      features: 2,
      appliedFeatures: 1,
      tagCopyActions: 0,
      copiedTagValues: 0,
      networkAttachmentActions: 1,
      skippedFeatures: 1,
    });
    expect(outcome.features.find((feature) => feature.sourceId === 101)).toMatchObject({
      copiedKeys: [],
      connectedWayIds: [20],
      skipped: false,
    });
    expect(outcome.tags[0]?.uncopied).toEqual([
      expect.objectContaining({ entityType: "node", sourceId: 101, reason: "not-selected" }),
      expect.objectContaining({ entityType: "node", sourceId: 102, reason: "not-selected" }),
    ]);
    worker.applyChangesAndReplace(base.id);
    expect(worker.getOsm(base.id).ways.getById(20)?.refs).toEqual([1, 102]);
    expect(worker.getOsm(base.id).nodes.getById(1)?.tags?.["tactile_paving"]).toBe("no");
    expect(worker.getOsm(base.id).nodes.getById(2)?.tags?.["tactile_paving"]).toBe("no");
  });
});

function summary(
  overrides: Partial<OsmConflationOutcomeReport["summary"]> = {},
): OsmConflationOutcomeReport["summary"] {
  return {
    features: 0,
    appliedFeatures: 0,
    tagCopyActions: 0,
    copiedTagValues: 0,
    networkAttachmentActions: 0,
    unresolvedFeatures: 0,
    ambiguousFeatures: 0,
    blockedFeatures: 0,
    unmatchedFeatures: 0,
    reviewFeatures: 0,
    skippedFeatures: 0,
    unchangedFeatures: 0,
    ...overrides,
  };
}
