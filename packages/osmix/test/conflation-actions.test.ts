import { describe, expect, it } from "vitest";

import {
  type MergePlanOptions,
  Osm,
  OsmixRemote,
  OsmixWorker,
  type PlanDecision,
  type PlanProposal,
} from "../src/index";
import { RoutingTestHarness } from "./routing-harness";

const connectId = "connect:n101>n1";
const copyId = "copy:n101>n1";
const matching = { propertyKeys: ["name"], attachNetwork: true };
const planOptions: MergePlanOptions = {
  mergeIdenticalPoints: false,
  createIntersections: false,
  matching,
};

interface Actions {
  transferProperties: boolean;
  attachNetwork: boolean;
}

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

function setupWorker(blockAttachment = false, options: MergePlanOptions = planOptions) {
  const { base, patch } = inputs(blockAttachment);
  const worker = new TestWorker();
  worker.setOsm(base);
  worker.setOsm(patch);
  worker.planMerge(base.id, patch.id, options);
  return { worker, base, patch };
}

/** The entrance's proposals, by ID, from the imported way's feature. */
function entranceProposals(features: { proposals: PlanProposal[] }[]) {
  const proposals = new Map(
    features.flatMap((feature) => feature.proposals).map((proposal) => [proposal.id, proposal]),
  );
  const connect = proposals.get(connectId);
  const copy = proposals.get(copyId);
  if (!connect || !copy) throw Error("Expected entrance proposals");
  return { connect, copy };
}

function decisionsFor(actions: Actions): PlanDecision[] {
  return [
    { proposalId: copyId, action: actions.transferProperties ? "accept" : "reject" },
    { proposalId: connectId, action: actions.attachNetwork ? "accept" : "reject" },
  ];
}

function expectEffects(features: { proposals: PlanProposal[] }[], actions: Actions) {
  const { connect, copy } = entranceProposals(features);
  expect(copy.effect).toBe(actions.transferProperties ? "applied" : "skipped");
  expect(connect.effect).toBe(actions.attachNetwork ? "applied" : "skipped");
}

function expectResult(osm: Osm, base: Osm, patch: Osm, actions: Actions) {
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
  { name: "copy only", transferProperties: true, attachNetwork: false },
  { name: "connect only", transferProperties: false, attachNetwork: true },
  { name: "both", transferProperties: true, attachNetwork: true },
  { name: "neither", transferProperties: false, attachNetwork: false },
] as const;

describe("scheduled matching actions", () => {
  it.each(selections)(
    "preserves $name through paging, replanning, and worker recovery",
    async ({ transferProperties, attachNetwork }) => {
      const { base, patch } = inputs();
      using remote = new RecoveryRemote();
      await remote.initializeWorkerPool(1, undefined, undefined, true);
      await remote.transferIn(base);
      await remote.transferIn(patch);
      await remote.planMerge(base.id, patch.id, planOptions);
      const planned = entranceProposals((await remote.getMergePlanPage(base.id, 0, 10)).features);
      expect(planned.copy.status).toBe("automatic");
      expect(planned.connect.status).toBe("automatic");
      const expected = { transferProperties, attachNetwork };
      const decided = await remote.setMergePlanDecisions(base.id, decisionsFor(expected));
      expect(decided.decisions).toEqual(decisionsFor(expected));
      await remote.setMergePlanFilter(base.id, { kind: "connect" });
      const page = await remote.getMergePlanPage(base.id, 0, 10);
      expectEffects(page.features, expected);
      const osc = await remote.getMergePlanOsc(base.id);

      await remote.restartForTest();

      expect(await remote.getMergePlanOverview(base.id)).toEqual(decided);
      expect(await remote.getMergePlanPage(base.id, 0, 10)).toEqual(page);
      expect(await remote.getMergePlanOsc(base.id)).toBe(osc);
      await remote.applyMergePlan(base.id);
      expectResult(await remote.get(base.id), base, patch, expected);
    },
  );

  it("toggles one action without changing the other and clears decisions back to automatic", () => {
    const { worker, base, patch } = setupWorker();
    for (const expected of [
      { transferProperties: false, attachNetwork: true },
      { transferProperties: false, attachNetwork: false },
      { transferProperties: true, attachNetwork: false },
      { transferProperties: true, attachNetwork: true },
    ]) {
      worker.setMergePlanDecisions(base.id, decisionsFor(expected));
      expectEffects(worker.getMergePlanPage(base.id, 0, 10).features, expected);
    }
    const cleared = worker.setMergePlanDecisions(base.id, []);
    expect(cleared.decisions).toEqual([]);
    const automatic = entranceProposals(worker.getMergePlanPage(base.id, 0, 10).features);
    expect(automatic.copy).not.toHaveProperty("decision");
    expect(automatic.connect).not.toHaveProperty("decision");
    expectEffects([{ proposals: [automatic.copy, automatic.connect] }], {
      transferProperties: true,
      attachNetwork: true,
    });
    worker.applyMergePlan(base.id);
    expectResult(worker.getOsm(base.id), base, patch, {
      transferProperties: true,
      attachNetwork: true,
    });
  });

  it.each(["undecided", "rejected", "connect-only"] as const)(
    "makes row and bulk copy acceptance equivalent from %s",
    (initial) => {
      // Bulk acceptance applies to proposals that need a decision, so nothing is automatic.
      const options = { ...planOptions, matching: { ...matching, automatic: "none" as const } };
      const row = setupWorker(false, options);
      const bulk = setupWorker(false, options);
      const prior: PlanDecision[] =
        initial === "undecided"
          ? []
          : [
              { proposalId: copyId, action: "reject" },
              {
                proposalId: connectId,
                action: initial === "connect-only" ? "accept" : "reject",
              },
            ];
      row.worker.setMergePlanDecisions(row.base.id, prior);
      bulk.worker.setMergePlanDecisions(bulk.base.id, prior);
      row.worker.setMergePlanDecisions(row.base.id, [
        ...prior.filter(({ proposalId }) => proposalId !== copyId),
        { proposalId: copyId, action: "accept" },
      ]);
      const result = bulk.worker.applyMergePlanBulk(bulk.base.id, {
        action: "accept",
        filter: { kind: "copy-tags" },
      });
      expect(result).toMatchObject({ changed: 1, skipped: 0 });
      const expected = { transferProperties: true, attachNetwork: initial === "connect-only" };
      for (const { worker, base, patch } of [row, bulk]) {
        const { connect, copy } = entranceProposals(
          worker.getMergePlanPage(base.id, 0, 10).features,
        );
        expect(copy.effect).toBe("applied");
        expect(connect.effect).toBe(
          initial === "connect-only"
            ? "applied"
            : initial === "undecided"
              ? "needs-decision"
              : "skipped",
        );
        worker.applyMergePlan(base.id);
        expectResult(worker.getOsm(base.id), base, patch, expected);
      }
    },
  );

  it("keeps a blocked connection out of the result while an eligible tag copy applies", () => {
    const { worker, base, patch } = setupWorker(true);
    const planned = entranceProposals(worker.getMergePlanPage(base.id, 0, 10).features);
    expect(planned.copy.status).toBe("automatic");
    expect(planned.connect.status).toBe("blocked");
    worker.setMergePlanDecisions(
      base.id,
      decisionsFor({ transferProperties: true, attachNetwork: true }),
    );
    const { connect, copy } = entranceProposals(worker.getMergePlanPage(base.id, 0, 10).features);
    expect(copy.effect).toBe("applied");
    expect(connect).toMatchObject({ decision: "accept", effect: "blocked" });
    worker.applyMergePlan(base.id);
    expectResult(worker.getOsm(base.id), base, patch, {
      transferProperties: true,
      attachNetwork: false,
    });
  });
});
