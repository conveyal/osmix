import { describe, expect, it } from "vitest";

import {
  applyPlan,
  type MergePlanOptions,
  Osm,
  type OsmConflationOptions,
  type OsmConflationOutcomeReport,
  type OsmNode,
  OsmixRemote,
  OsmixWorker,
  planMerge,
  type PlanDecision,
} from "../src/index";
import { fullMatchingOutcome } from "./plan-decisions.ts";

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

const direct: MergePlanOptions = { mergeIdenticalPoints: false, createIntersections: false };

function planOptions(matching: OsmConflationOptions): MergePlanOptions {
  return { ...direct, matching };
}

function finish(base: Osm, patch: Osm, options: OsmConflationOptions) {
  for (const osm of [base, patch]) {
    osm.buildIndexes();
    osm.buildSpatialIndexes();
  }
  const worker = new TestWorker();
  worker.add(base);
  worker.add(patch);
  worker.planMerge(base.id, patch.id, planOptions(options));
  return { base, patch, worker, options };
}

/** The matching outcome of the worker's plan for `baseId`, after `decisions` if given. */
function outcomeOf(worker: TestWorker, baseId: string, decisions?: PlanDecision[]) {
  const overview = decisions
    ? worker.setMergePlanDecisions(baseId, decisions)
    : worker.getMergePlanOverview(baseId);
  return fullMatchingOutcome(worker, baseId, overview);
}

const reject301: PlanDecision = { proposalId: "copy:n301>n4", action: "reject" };

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

describe("matching plan outcomes", () => {
  it("counts actual copied values and retains the report after applying a fully matched import", () => {
    const { worker, base } = propertyInputs("applied");
    const outcome = outcomeOf(worker, base.id);
    expect(outcome.summary).toEqual(
      summary({ features: 1, appliedFeatures: 1, tagCopyActions: 1, copiedTagValues: 1 }),
    );
    expect(outcome.tags.find((tag) => tag.key === "tactile_paving")).toMatchObject({
      presentFeatures: 1,
      copiedFeatures: 1,
      alreadyEqualFeatures: 0,
      uncopied: [],
    });
    expect(outcome.features).toEqual([
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
    expect(outcome.retainedImports).toEqual({
      originalIds: { nodes: 1, ways: 0, relations: 0 },
      ordinaryAdditions: { nodes: 1, ways: 0, relations: 0 },
    });
    const saved = structuredClone(outcome);
    worker.applyMergePlan(base.id);
    expect(worker.getOsm(base.id).nodes.getById(1)?.tags?.["tactile_paving"]).toBe("yes");
    expect(worker.getOsm(base.id).nodes.getById(101)?.tags?.["tactile_paving"]).toBe("yes");
    expect(() => worker.getMergePlanOverview(base.id)).toThrow("No active merge plan");
    expect(outcome).toEqual(saved);
  });

  it("separates mixed outcomes by imported feature and identifies uncopied selected tags", () => {
    const { worker, base, patch } = propertyInputs("mixed");
    const outcome = outcomeOf(worker, base.id, [reject301]);
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
    worker.applyMergePlan(base.id);
    const actual = worker.getOsm(base.id);
    expect([...actual.nodes.sorted()]).toEqual(
      [...base.nodes.sorted(), ...patch.nodes.sorted()].map((node) =>
        node.id === 1 ? { ...node, tags: { tactile_paving: "yes" } } : node,
      ),
    );
    expect([...actual.ways.sorted()]).toEqual([]);
    expect([...actual.relations.sorted()]).toEqual([]);
  });

  it("summarizes the lists in the overview and pages them from the worker", () => {
    const { worker, base } = propertyInputs("mixed");
    const overview = worker.setMergePlanDecisions(base.id, [reject301]);
    const outcome = fullMatchingOutcome(worker, base.id, overview);
    expect(overview.matching?.outcome.tags).toEqual(
      outcome.tags.map(({ uncopied, ...tag }) => ({ ...tag, uncopiedFeatures: uncopied.length })),
    );
    expect(overview.matching?.outcome.wayRemovalFeatures).toBe(0);
    const unresolved = outcome.features.filter((feature) => feature.unresolved !== null);
    const first = worker.getMergeMatchingPage(base.id, "unresolved", 0, 2);
    expect(first).toEqual({ features: unresolved.slice(0, 2), total: 3, totalPages: 2 });
    expect(worker.getMergeMatchingPage(base.id, "unresolved", 1, 2).features).toEqual(
      unresolved.slice(2),
    );
    expect(worker.getMergeMatchingPage(base.id, "skipped", 0, 10).total).toBe(1);
    expect(() => worker.getMergeUncopiedTagPage(base.id, "missing", 0, 10)).toThrow(
      "No tag missing in this matching outcome",
    );
  });

  it("reports an all-unresolved review without claiming its imported attributes were copied", () => {
    const { worker, base, patch, options } = propertyInputs("applied");
    worker.planMerge(base.id, patch.id, planOptions({ ...options, automatic: "none" }));
    const outcome = outcomeOf(worker, base.id);
    expect(outcome.summary).toEqual(
      summary({ features: 1, unresolvedFeatures: 1, reviewFeatures: 1 }),
    );
    expect(outcome.tags.find((tag) => tag.key === "tactile_paving")?.uncopied).toEqual([
      expect.objectContaining({ entityType: "node", sourceId: 101, reason: "no-accepted-target" }),
    ]);
    worker.applyMergePlan(base.id);
    expect([...worker.getOsm(base.id).nodes.sorted()]).toEqual([
      ...base.nodes.sorted(),
      ...patch.nodes.sorted(),
    ]);
  });

  it("reports zero candidates while preserving the ordinary import", () => {
    const { worker, base, patch } = propertyInputs("zero");
    const outcome = outcomeOf(worker, base.id);
    expect(outcome.summary).toEqual(summary());
    expect(outcome.features).toEqual([]);
    expect(outcome.tags.every((tag) => tag.uncopied.length === 0)).toBe(true);
    expect(outcome.retainedImports).toEqual({
      originalIds: { nodes: 1, ways: 0, relations: 0 },
      ordinaryAdditions: { nodes: 1, ways: 0, relations: 0 },
    });
    worker.applyMergePlan(base.id);
    expect([...worker.getOsm(base.id).nodes.sorted()]).toEqual([
      ...base.nodes.sorted(),
      ...patch.nodes.sorted(),
    ]);
  });

  it("reports actual public and worker network changes and survives recovery and application", async () => {
    const { base, patch, options, worker } = networkInputs();
    const publicPlan = planMerge(base, patch, planOptions(options), () => {});
    const publicOutcome = structuredClone(publicPlan.matching?.outcome);
    const publicResult = applyPlan(publicPlan).osm;
    const outcome = outcomeOf(worker, base.id);
    expect(outcome).toEqual(publicOutcome);
    expect(outcome.summary).toEqual(
      summary({
        features: 2,
        appliedFeatures: 2,
        tagCopyActions: 2,
        copiedTagValues: 2,
        networkAttachmentActions: 2,
      }),
    );
    expect(outcome.features.map((feature) => feature.connectedWayIds)).toEqual([[20], [20]]);
    expect(outcome.retainedImports).toEqual({
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
    const planned = await remote.planMerge(base.id, patch.id, planOptions(options));
    expect(planned.matching?.outcome).toEqual(
      worker.getMergePlanOverview(base.id).matching?.outcome,
    );
    expect((await remote.getMergeMatchingPage(base.id, "all", 0, 10)).features).toEqual(
      outcome.features,
    );
    const retained = structuredClone(planned.matching?.outcome);
    const osc = await remote.getMergePlanOsc(base.id);
    await remote.restartForTest();
    expect(await remote.getMergePlanOsc(base.id)).toBe(osc);
    expect((await remote.getMergePlanOverview(base.id)).matching?.outcome).toEqual(retained);
    await remote.applyMergePlan(base.id);
    const actual = await remote.get(base.id);
    expect([...actual.nodes.sorted()]).toEqual([...publicResult.nodes.sorted()]);
    expect([...actual.ways.sorted()]).toEqual([...publicResult.ways.sorted()]);
    expect([...actual.relations.sorted()]).toEqual([...publicResult.relations.sorted()]);
    expect(planned.matching?.outcome).toEqual(retained);
    await expect(remote.getMergePlanOverview(base.id)).rejects.toThrow("No active merge plan");
  });

  it("detaches reports from review data and recomputes totals when a different target is selected", () => {
    const { worker, base } = propertyInputs("mixed");
    const first = outcomeOf(worker, base.id, [reject301]);
    const original = structuredClone(first);
    const page = worker.getMergePlanPage(base.id, 0, 100);
    first.summary.copiedTagValues = 999;
    first.features[0]!.candidateIds.push("not-a-canonical-candidate");
    first.features[0]!.reasons.push("geometry-mismatch");
    first.tags[0]!.uncopied.length = 0;
    expect(worker.getMergePlanPage(base.id, 0, 100)).toEqual(page);
    expect(outcomeOf(worker, base.id)).toEqual(original);
    const revised = outcomeOf(worker, base.id, [
      reject301,
      { proposalId: "copy:n201>n2", action: "accept" },
      { proposalId: "copy:n201>n3", action: "reject" },
    ]);
    expect(revised.summary).toEqual(
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
      revised.tags
        .find((tag) => tag.key === "tactile_paving")
        ?.uncopied.map((entry) => entry.sourceId),
    ).toEqual([301, 501]);
    worker.applyMergePlan(base.id);
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
    const outcome = outcomeOf(worker, base.id, [
      { proposalId: "copy:n101>n1", action: "accept" },
      { proposalId: "copy:n102>n1", action: "accept" },
    ]);
    const proposals = worker.getMergePlanPage(base.id, 0, 10).features.flatMap((f) => f.proposals);
    expect(
      proposals.filter(({ kind, effect }) => kind === "copy-tags" && effect === "applied"),
    ).toHaveLength(2);
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
    worker.applyMergePlan(base.id);
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
    const outcome = outcomeOf(worker, base.id);
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
    worker.applyMergePlan(base.id);
    expect([...worker.getOsm(base.id).nodes.sorted()]).toEqual([
      ...base.nodes.sorted(),
      ...patch.nodes.sorted(),
    ]);
  });

  it("reports uncopied selected attributes when a reviewed feature only connects the network", () => {
    const { worker, base } = networkInputs();
    const outcome = outcomeOf(worker, base.id, [
      { proposalId: "connect:n101>n1", action: "accept" },
      { proposalId: "copy:n101>n1", action: "reject" },
      { proposalId: "connect:n102>n2", action: "reject" },
      { proposalId: "copy:n102>n2", action: "reject" },
    ]);
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
    worker.applyMergePlan(base.id);
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
    removedConnectionOrphanNodes: 0,
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
