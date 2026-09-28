import { describe, expect, it } from "vitest";

import {
  applyPlan,
  discoverConflationCandidates,
  fromPbf,
  type MergePlanOptions,
  merge,
  Osm,
  type OsmConflationOptions,
  OsmixRemote,
  OsmixWorker,
  planMerge,
  type PlanDecision,
  type PlanProposal,
  setMergePlanDecisions,
  toPbfBuffer,
  MergePlanDecisionConflictError,
} from "../src/index";
import { withMatchingDecisions } from "./plan-decisions.ts";

const wayCandidateId = "way:20->10";
const removeId = "remove:w20>w10";
const branchConnectId = "connect:n102>n2";
const removalOptions: OsmConflationOptions = {
  propertyKeys: [],
  attachNetwork: false,
  allowWayRemoval: true,
};
const direct: MergePlanOptions = { mergeIdenticalPoints: false, createIntersections: false };
const acceptRemoval: PlanDecision = { proposalId: removeId, action: "accept" };
const acceptBranch: PlanDecision = { proposalId: branchConnectId, action: "accept" };

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
  worker.planMerge(base.id, patch.id, { ...direct, matching: options });
  return worker;
}

/** The removal candidate's evidence, as the worker shows it for the imported trunk. */
function wayCandidate(worker: TestWorker, baseId: string) {
  const candidate = worker.getMergePlanFeature(baseId, "way:20").candidates[removeId];
  if (!candidate) throw Error("Expected removal candidate");
  return candidate;
}

function proposal(worker: TestWorker, baseId: string, id: string): PlanProposal {
  const found = worker
    .getMergePlanPage(baseId, 0, 100)
    .features.flatMap((feature) => feature.proposals)
    .find((proposal) => proposal.id === id);
  if (!found) throw Error(`Expected proposal ${id}`);
  return found;
}

function outcomeOf(worker: TestWorker, baseId: string) {
  const outcome = worker.getMergePlanOverview(baseId).matching?.outcome;
  if (!outcome) throw Error("Expected a matching outcome");
  return outcome;
}

describe("explicit way removal through the facade and worker", () => {
  it("keeps imported geometry for existing property-only callers", async () => {
    const { base, patch } = inputs();
    const result = await merge(base, patch, {
      ...direct,
      matching: { propertyKeys: ["name"], attachNetwork: false },
    });
    expect(result.ways.getById(10)?.tags?.["name"]).toBe("Imported trunk");
    expect(result.ways.getById(20)).toEqual(patch.ways.getById(20));
    expect([...result.nodes.sorted()]).toEqual([...base.nodes.sorted(), ...patch.nodes.sorted()]);
  });

  it("enables removal review without selecting removal automatically", async () => {
    const { base, patch } = inputs();
    const options = { propertyKeys: ["name"], attachNetwork: false, allowWayRemoval: true };
    const discovery = discoverConflationCandidates(base, patch, options);
    const candidate = discovery.candidates.find((candidate) => candidate.id === wayCandidateId);
    expect(candidate).toMatchObject({ wayRemoval: { status: "review" } });
    const plan = planMerge(base, patch, { ...direct, matching: options }, () => {});
    expect(plan.proposals.get(removeId)).toMatchObject({
      status: "review",
      effect: "needs-decision",
    });
    // Accepting the candidate without asking for removal copies its tags and keeps the way.
    const accepted = withMatchingDecisions(base, patch, { ...direct, matching: options }, [
      { candidateId: wayCandidateId, action: "accept" },
    ]);
    expect(accepted.decisions).toEqual([{ proposalId: "copy:w20>w10", action: "accept" }]);
    const result = await merge(base, patch, accepted);
    expect(result.ways.getById(20)).toEqual(patch.ways.getById(20));
    expect(result.ways.getById(10)?.tags?.["name"]).toBe("Imported trunk");
  });

  it("supports removal alone and cleans only newly orphaned imported nodes", async () => {
    const { base, patch } = inputs();
    const plan = planMerge(base, patch, { ...direct, matching: removalOptions }, () => {});
    setMergePlanDecisions(plan, [acceptRemoval]);
    const outcome = plan.matching!.outcome;
    const result = applyPlan(plan).osm;
    expect([...result.ways.sorted()]).toEqual([...base.ways.sorted()]);
    expect([...result.nodes.sorted()]).toEqual([...base.nodes.sorted(), patch.nodes.getById(103)]);
    expect(outcome.features.find((feature) => feature.sourceId === 20)).toMatchObject({
      targetId: 10,
      retained: false,
      skipped: false,
    });
    expect(outcome.summary.appliedFeatures).toBe(1);
    const reloaded = await fromPbf(await toPbfBuffer(result), { id: "removal-reloaded" });
    expect(entities(reloaded)).toEqual(entities(result));
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
    worker.setMergePlanDecisions(base.id, [acceptRemoval]);
    const outcome = outcomeOf(worker, base.id);
    expect(outcome.summary).toMatchObject({
      appliedFeatures: 1,
      wayRemovalActions: 1,
      removedOrphanNodes: 1,
      skippedFeatures: 0,
    });
    expect(outcome.features.find((feature) => feature.sourceId === 20)?.wayRemoval).toMatchObject({
      orphanNodeIds: [102],
      retainedTaggedNodeIds: [101],
    });
    expect(worker.getOsm(base.id).ways.ids.has(10)).toBe(true);
    expect(worker.getOsm(patch.id).ways.ids.has(20)).toBe(true);
    worker.applyMergePlan(base.id);
    const result = worker.getOsm(base.id);
    expect([...result.ways.sorted()]).toEqual([...base.ways.sorted()]);
    expect(result.nodes.getById(101)).toEqual(patch.nodes.getById(101));
    expect(result.nodes.getById(103)).toEqual(patch.nodes.getById(103));
    expect(result.nodes.ids.has(102)).toBe(false);
  });

  it("requires explicit branch connections and reassesses removal on every decision", async () => {
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
    // A blocked removal can be accepted, but it stays blocked and is not applied.
    worker.setMergePlanDecisions(base.id, [acceptRemoval]);
    expect(proposal(worker, base.id, removeId)).toMatchObject({
      status: "blocked",
      effect: "blocked",
      reasons: ["way-removal-connection-required"],
    });
    expect(outcomeOf(worker, base.id).summary.wayRemovalActions).toBeUndefined();

    worker.setMergePlanDecisions(base.id, [acceptBranch]);
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
    worker.setMergePlanDecisions(base.id, [acceptBranch, acceptRemoval]);
    expect(proposal(worker, base.id, removeId).effect).toBe("applied");
    const removal = outcomeOf(worker, base.id).features.find(
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

    // Rejecting the connection blocks the accepted removal again.
    const osc = worker.getMergePlanOsc(base.id);
    worker.setMergePlanDecisions(base.id, [
      { proposalId: branchConnectId, action: "reject" },
      acceptRemoval,
    ]);
    expect(proposal(worker, base.id, removeId)).toMatchObject({
      decision: "accept",
      effect: "blocked",
    });
    worker.setMergePlanDecisions(base.id, [acceptBranch, acceptRemoval]);
    expect(worker.getMergePlanOsc(base.id)).toBe(osc);

    worker.applyMergePlan(base.id);
    const result = worker.getOsm(base.id);
    expect(result.ways.ids.has(20)).toBe(false);
    expect(result.ways.getById(10)).toEqual(base.ways.getById(10));
    expect(result.ways.getById(30)?.refs).toEqual([2, 103]);
    expect(result.nodes.ids.has(101)).toBe(false);
    // The explicit connection left untagged 102 unused, so it is dropped too.
    expect(result.nodes.ids.has(102)).toBe(false);
    const reloaded = await fromPbf(await toPbfBuffer(result), { id: "branch-reloaded" });
    expect(entities(reloaded)).toEqual(entities(result));
  });

  it("keeps automatic attachments insufficient to approve branch removal", () => {
    const { base, patch } = inputs({ branch: true });
    const worker = workerFor(base, patch, { ...removalOptions, attachNetwork: true });
    expect(wayCandidate(worker, base.id).wayRemoval?.status).toBe("blocked");
    worker.setMergePlanDecisions(base.id, [acceptRemoval]);
    expect(proposal(worker, base.id, removeId)).toMatchObject({
      status: "blocked",
      effect: "blocked",
    });
    expect(outcomeOf(worker, base.id).summary.wayRemovalActions).toBeUndefined();
    expect(wayCandidate(worker, base.id).wayRemoval?.status).toBe("blocked");
  });

  // BUG (plan matching): accepting only the tag copy of an automatic connection candidate turns
  // the automatic connection into an explicit one. `matchingDecisions` in
  // packages/change/src/plan/matching.ts writes `attachNetwork: true` for every applied connect
  // proposal of a decided candidate, so the branch removal becomes reviewable (status "review",
  // `explicitlyAccepted: true`) without the connection ever being accepted.
  it.skip("does not treat tag copying as explicit branch-connection confirmation", () => {
    const { base, patch } = inputs({ branch: true, taggedBranch: true });
    const worker = workerFor(base, patch, {
      ...removalOptions,
      propertyKeys: ["name"],
      attachNetwork: true,
    });
    expect(proposal(worker, base.id, branchConnectId).status).toBe("automatic");
    expect(proposal(worker, base.id, "copy:n102>n2").status).toBe("automatic");
    for (const action of ["reject", "accept"] as const) {
      worker.setMergePlanDecisions(base.id, [{ proposalId: "copy:n102>n2", action }]);
      expect(wayCandidate(worker, base.id).wayRemoval).toMatchObject({
        status: "blocked",
        preview: { connections: [{ explicitlyAccepted: false }] },
      });
    }
  });

  it("confirms a branch connection only when its connect proposal is accepted", () => {
    const { base, patch } = inputs({ branch: true, taggedBranch: true });
    const worker = workerFor(base, patch, {
      ...removalOptions,
      propertyKeys: ["name"],
      attachNetwork: true,
      automatic: "none",
    });
    const copied = worker.applyMergePlanBulk(base.id, {
      action: "accept",
      filter: { kind: "copy-tags" },
    });
    expect(copied.overview.decisions).toContainEqual({
      proposalId: "copy:n102>n2",
      action: "accept",
    });
    expect(proposal(worker, base.id, branchConnectId).effect).toBe("needs-decision");
    expect(wayCandidate(worker, base.id).wayRemoval).toMatchObject({
      status: "blocked",
      preview: { connections: [{ explicitlyAccepted: false }] },
    });

    const connected = worker.applyMergePlanBulk(base.id, {
      action: "accept",
      filter: { kind: "connect" },
    });
    expect(connected.overview.decisions).toContainEqual(acceptBranch);
    expect(wayCandidate(worker, base.id).wayRemoval).toMatchObject({
      status: "review",
      preview: { connections: [{ explicitlyAccepted: true }] },
    });
    worker.setMergePlanDecisions(base.id, [...connected.overview.decisions, acceptRemoval]);
    expect(outcomeOf(worker, base.id).summary.wayRemovalActions).toBe(1);
    worker.applyMergePlan(base.id);
    const result = worker.getOsm(base.id);
    expect(result.ways.ids.has(20)).toBe(false);
    expect(result.ways.getById(30)?.refs).toEqual([2, 103]);
    expect(result.nodes.getById(2)?.tags?.["name"]).toBe("Branch connection");
  });

  it("links connections that compete for one base node, and bulk include skips them", () => {
    const { base, patch } = inputs({ branch: true, extraContender: true });
    const worker = workerFor(base, patch, {
      ...removalOptions,
      attachNetwork: true,
      automatic: "none",
    });
    const connects = worker
      .getMergePlanPage(base.id, 0, 100)
      .features.flatMap(({ proposals }) => proposals)
      .flatMap((proposal) =>
        proposal.kind === "connect" && proposal.target.id === 1 ? [proposal] : [],
      );
    expect(connects.map((proposal) => [proposal.id, proposal.competitors])).toEqual([
      ["connect:n101>n1", ["connect:n201>n1"]],
      ["connect:n201>n1", ["connect:n101>n1"]],
    ]);

    // Include all shown leaves competing connections for their own choice (MP-M5) instead of
    // including a set that planning must refuse.
    const result = worker.applyMergePlanBulk(base.id, { action: "accept", filter: {} });
    const included = result.overview.decisions
      .filter(({ action }) => action === "accept")
      .map(({ proposalId }) => proposalId);
    expect(included).not.toContain("connect:n101>n1");
    expect(included).not.toContain("connect:n201>n1");
    expect(result.skipped).toBe(2);
  });

  it("refuses to plan with two competing connections included, naming both", () => {
    const { base, patch } = inputs({ branch: true, extraContender: true });
    const decisions: PlanDecision[] = [
      { proposalId: "connect:n101>n1", action: "accept" },
      { proposalId: "connect:n201>n1", action: "accept" },
    ];
    const matching = { ...removalOptions, attachNetwork: true, automatic: "none" as const };
    expect(() => planMerge(base, patch, { ...direct, matching, decisions })).toThrow(
      MergePlanDecisionConflictError,
    );
  });

  it("never includes a removal in bulk (MP-R1)", () => {
    const { base, patch } = inputs();
    const worker = workerFor(base, patch);
    expect(wayCandidate(worker, base.id).wayRemoval?.status).toBe("review");
    const result = worker.applyMergePlanBulk(base.id, { action: "accept", filter: {} });
    expect(result.overview.decisions).not.toContainEqual(acceptRemoval);
    expect(result.skipped).toBe(1);
  });

  it("keeps the plan unchanged when two included connections compete for one base node", () => {
    const { base, patch } = inputs({ branch: true, extraContender: true });
    const worker = workerFor(base, patch, {
      ...removalOptions,
      attachNetwork: true,
      automatic: "none",
    });
    worker.setMergePlanDecisions(base.id, [acceptBranch, acceptRemoval]);
    const overview = worker.getMergePlanOverview(base.id);
    const page = worker.getMergePlanPage(base.id, 0, 100);
    const osc = worker.getMergePlanOsc(base.id);
    expect(() =>
      worker.setMergePlanDecisions(base.id, [
        { proposalId: "connect:n101>n1", action: "accept" },
        { proposalId: "connect:n201>n1", action: "accept" },
      ]),
    ).toThrow(
      /^Imported node 101 \(on imported way 20\) and imported node 201 \(on imported way 40\) would both connect to base node 1,/,
    );
    expect(worker.getMergePlanOverview(base.id)).toEqual(overview);
    expect(worker.getMergePlanPage(base.id, 0, 100)).toEqual(page);
    expect(worker.getMergePlanOsc(base.id)).toBe(osc);
    expect(wayCandidate(worker, base.id).wayRemoval?.status).toBe("review");
  });

  it("records a removal decision as stale when removal is not enabled", () => {
    const { base, patch } = inputs();
    const worker = workerFor(base, patch, { propertyKeys: ["name"], attachNetwork: false });
    const page = worker.getMergePlanPage(base.id, 0, 100);
    const osc = worker.getMergePlanOsc(base.id);
    const decided = worker.setMergePlanDecisions(base.id, [acceptRemoval]);
    expect(decided.staleDecisions).toEqual([removeId]);
    expect(worker.getMergePlanPage(base.id, 0, 100)).toEqual(page);
    expect(worker.getMergePlanOsc(base.id)).toBe(osc);
  });

  it("recovers removal choices, page evidence and plan outcomes without sharing mutable reports", async () => {
    const { base, patch } = inputs({ branch: true });
    const matching: OsmConflationOptions = {
      ...removalOptions,
      attachNetwork: true,
      automatic: "none",
    };
    using remote = new RecoveryRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    await remote.planMerge(base.id, patch.id, { ...direct, matching });
    matching.allowWayRemoval = false;
    const decided = await remote.setMergePlanDecisions(base.id, [acceptBranch, acceptRemoval]);
    await remote.setMergePlanFilter(base.id, { kind: "remove-way" });
    const page = await remote.getMergePlanPage(base.id, 0, 1);
    expect(page.features.map(({ key }) => key)).toEqual(["way:20"]);
    const expectedOutcome = structuredClone(decided.matching?.outcome);
    const osc = await remote.getMergePlanOsc(base.id);
    const mutable = decided.matching?.outcome.features.find(
      (feature) => feature.sourceId === 20,
    )?.wayRemoval;
    if (!mutable) throw Error("Expected planned removal report");
    mutable.orphanNodeIds.push(103);
    mutable.connections[0]!.retainedWayIds.length = 0;
    await remote.restartForTest();
    expect(await remote.getMergePlanPage(base.id, 0, 1)).toEqual(page);
    expect(await remote.getMergePlanOsc(base.id)).toBe(osc);
    const recovered = await remote.getMergePlanOverview(base.id);
    expect(recovered.matching?.outcome).toEqual(expectedOutcome);
    await remote.applyMergePlan(base.id);
    const result = await remote.get(base.id);
    expect(result.ways.ids.has(20)).toBe(false);
    expect(result.ways.getById(30)?.refs).toEqual([2, 103]);
    expect(recovered.matching?.outcome).toEqual(expectedOutcome);
    await expect(remote.getMergePlanOverview(base.id)).rejects.toThrow("No active merge plan");
  });

  it("invalidates a removal plan when an input is replaced under the same ID", async () => {
    const { base, patch } = inputs();
    using remote = new RecoveryRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    await remote.planMerge(base.id, patch.id, { ...direct, matching: removalOptions });
    await remote.setMergePlanDecisions(base.id, [acceptRemoval]);
    const replacement = inputs({ branch: true }).patch;
    await remote.transferIn(replacement);
    await expect(remote.getMergePlanOverview(base.id)).rejects.toThrow("No active merge plan");
    await expect(remote.applyMergePlan(base.id)).rejects.toThrow("No active merge plan");
    await remote.restartForTest();
    await expect(remote.getMergePlanOverview(base.id)).rejects.toThrow("No active merge plan");
    expect(entities(await remote.get(base.id))).toEqual(entities(base));
    expect((await remote.get(patch.id)).ways.getById(30)?.refs).toEqual([102, 103]);
  });
});
