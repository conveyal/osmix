import * as Comlink from "comlink";
import { describe, expect, it } from "vitest";

import {
  type MergePlanOptions,
  Osm,
  OsmixRemote,
  OsmixWorker,
  type PlanDecision,
  type PlanProposal,
} from "../src/index";

const options: MergePlanOptions = {
  mergeIdenticalPoints: false,
  createIntersections: false,
  matching: { propertyKeys: ["name"], attachNetwork: false },
};
const first: PlanDecision = { proposalId: "copy:n101>n1", action: "accept" };
const second: PlanDecision = { proposalId: "copy:n101>n2", action: "accept" };
const unrelated: PlanDecision = { proposalId: "copy:n102>n3", action: "reject" };
const reject = (decision: PlanDecision): PlanDecision => ({ ...decision, action: "reject" });

function inputs() {
  const base = new Osm({ id: "alternatives-base" });
  for (const node of [
    { id: 1, lon: -0.000003, lat: 0, tags: { name: "West entrance" } },
    { id: 2, lon: 0.000003, lat: 0, tags: { name: "East entrance" } },
    { id: 3, lon: 0.01, lat: 0, tags: { name: "Other entrance" } },
  ])
    base.nodes.addNode(node);
  base.buildIndexes();
  base.buildSpatialIndexes();
  const patch = new Osm({ id: "alternatives-patch" });
  patch.nodes.addNode({ id: 101, lon: 0, lat: 0, tags: { name: "Imported entrance" } });
  patch.nodes.addNode({ id: 102, lon: 0.010005, lat: 0, tags: { name: "Unrelated import" } });
  patch.buildIndexes();
  patch.buildSpatialIndexes();
  return { base, patch };
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
    await worker.delete("alternatives-base");
    await worker.delete("alternatives-patch");
    await this.restorePoolWorker(worker, 0, 1);
  }
}

function setup() {
  const { base, patch } = inputs();
  const worker = new TestWorker();
  worker.add(base);
  worker.add(patch);
  worker.planMerge(base.id, patch.id, options);
  return { worker, base, patch };
}

function planState(worker: OsmixWorker, baseId: string) {
  return {
    overview: worker.getMergePlanOverview(baseId),
    page: worker.getMergePlanPage(baseId, 0, 10),
    osc: worker.getMergePlanOsc(baseId),
  };
}

function proposals(page: { features: { proposals: PlanProposal[] }[] }) {
  return new Map(
    page.features
      .flatMap((feature) => feature.proposals)
      .map((proposal) => [proposal.id, proposal]),
  );
}

describe("alternative target review", () => {
  it("links proposals for the same imported feature as alternatives that need a decision", () => {
    const { worker, base } = setup();
    const page = worker.getMergePlanPage(base.id, 0, 1);
    expect(page.total).toBe(2);
    expect(page.features[0]).toMatchObject({ key: "node:101", outcome: "needs-decision" });
    const byId = proposals(page);
    expect(byId.get(first.proposalId)).toMatchObject({
      candidateId: "node:101->1",
      status: "review",
      effect: "needs-decision",
      reasons: ["multiple-targets"],
      alternatives: [second.proposalId],
    });
    expect(byId.get(second.proposalId)).toMatchObject({
      candidateId: "node:101->2",
      alternatives: [first.proposalId],
    });
    const other = proposals(worker.getMergePlanPage(base.id, 1, 1)).get(unrelated.proposalId);
    expect(other).toMatchObject({ status: "automatic", alternatives: [] });
  });

  it("refuses to accept two alternatives for one imported feature", () => {
    const { worker, base } = setup();
    worker.setMergePlanDecisions(base.id, [first, unrelated]);
    expect(() => worker.setMergePlanDecisions(base.id, [first, second, unrelated])).toThrow(
      /node 101/i,
    );
  });

  it("rejects a conflicting update before changing the plan", () => {
    const { worker, base } = setup();
    worker.setMergePlanDecisions(base.id, [first, unrelated]);
    const before = planState(worker, base.id);
    expect(() => worker.setMergePlanDecisions(base.id, [first, second, unrelated])).toThrow(
      /node 101/i,
    );
    expect(planState(worker, base.id)).toEqual(before);
  });

  it("skips ambiguous alternatives in bulk even when one target is already selected", () => {
    const { worker, base } = setup();
    // Undecided, the feature waits for a choice between its alternatives; once one is included,
    // the other is left out and nothing waits.
    for (const [decisions, waiting] of [
      [[], 1],
      [[first, unrelated], 0],
    ] as const) {
      worker.setMergePlanDecisions(base.id, [...decisions]);
      const before = planState(worker, base.id);
      const result = worker.applyMergePlanBulk(base.id, {
        action: "accept",
        filter: { kind: "copy-tags" },
      });
      expect(result).toMatchObject({ changed: 0, waiting });
      expect(planState(worker, base.id)).toEqual(before);
    }
  });

  it("can leave an imported feature unmatched by rejecting every alternative", () => {
    const { worker, base, patch } = setup();
    worker.setMergePlanDecisions(base.id, [reject(first), reject(second), unrelated]);
    const byId = proposals(worker.getMergePlanPage(base.id, 0, 10));
    expect(byId.get(first.proposalId)?.effect).toBe("skipped");
    expect(byId.get(second.proposalId)?.effect).toBe("skipped");
    expect(worker.getMergePlanOsc(base.id)).toMatch(/<modify><\/modify>/);
    worker.applyMergePlan(base.id);
    const result = worker.getOsm(base.id);
    expect([...result.nodes.sorted()]).toEqual([...base.nodes.sorted(), ...patch.nodes.sorted()]);
  });

  it("preserves the conflict message across actual Comlink calls", async () => {
    const { worker, base } = setup();
    worker.setMergePlanDecisions(base.id, [first, unrelated]);
    const { port1, port2 } = new MessageChannel();
    Comlink.expose(worker, port1);
    const remote = Comlink.wrap<OsmixWorker>(port2);
    try {
      await expect(
        remote.setMergePlanDecisions(base.id, [first, second, unrelated]),
      ).rejects.toThrow(/copy:n101>n1 and copy:n101>n2 are included, but imported node 101/);
    } finally {
      port1.close();
      port2.close();
    }
  });

  it("preserves valid decisions and the exact plan through remote recovery", async () => {
    const { base, patch } = inputs();
    using remote = new RecoveryRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    await remote.planMerge(base.id, patch.id, options);
    const decided = await remote.setMergePlanDecisions(base.id, [first, unrelated]);
    await remote.setMergePlanFilter(base.id, { outcome: "needs-decision" });
    const page = await remote.getMergePlanPage(base.id, 0, 1);
    const osc = await remote.getMergePlanOsc(base.id);
    const bulk = await remote.applyMergePlanBulk(base.id, {
      action: "accept",
      filter: { kind: "copy-tags" },
    });
    expect(bulk).toMatchObject({ changed: 0, waiting: 0 });

    await remote.restartForTest();

    expect(await remote.getMergePlanOverview(base.id)).toEqual(decided);
    expect(await remote.getMergePlanPage(base.id, 0, 1)).toEqual(page);
    expect(await remote.getMergePlanOsc(base.id)).toBe(osc);
    const replaced = await remote.setMergePlanDecisions(base.id, [
      reject(first),
      second,
      unrelated,
    ]);
    expect(replaced.decisions).toEqual([reject(first), second, unrelated]);
    const replacement = await remote.getMergePlanOsc(base.id);
    expect(replacement).toMatch(/<modify><node id="2"[^>]*><tag k="name" v="Imported entrance"/);
    expect(replacement).not.toMatch(/<node id="[13]"/);
    await remote.restartForTest();
    expect(await remote.getMergePlanOsc(base.id)).toBe(replacement);
    await remote.setMergePlanFilter(base.id, {});
    const restored = proposals(await remote.getMergePlanPage(base.id, 0, 10));
    expect(restored.get(first.proposalId)?.decision).toBe("reject");
    expect(restored.get(second.proposalId)?.decision).toBe("accept");
    expect(restored.get(unrelated.proposalId)?.decision).toBe("reject");
    await remote.applyMergePlan(base.id);
    const result = await remote.get(base.id);
    const expected = [...base.nodes.sorted(), ...patch.nodes.sorted()].map((node) =>
      node.id === 2 ? { ...node, tags: { name: "Imported entrance" } } : node,
    );
    expect([...result.nodes.sorted()]).toEqual(expected);
    expect([...result.ways.sorted()]).toEqual([]);
    expect([...result.relations.sorted()]).toEqual([]);
  });
});
