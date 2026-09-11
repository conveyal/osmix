import { describe, expect, it } from "vitest";

import { fromPbf, merge, Osm, type OsmConflationDecision, toPbfBuffer } from "../src/index.ts";
import { OsmixWorker } from "../src/worker.ts";
import { RoutingTestHarness } from "./routing-harness.ts";

const ordinaryOptions = {
  directMerge: true,
  deduplicateNodes: true,
  deduplicateWays: true,
  createIntersections: false,
};

const propertyOptions = { propertyKeys: ["name"], attachNetwork: false };
const trunkDecision: OsmConflationDecision = {
  candidateId: "way:20->10",
  action: "accept",
  transferProperties: true,
  attachNetwork: false,
};

class TestWorker extends OsmixWorker {
  setOsm(osm: Osm) {
    this.set(osm.id, osm);
  }

  getOsm(id: string) {
    return this.get(id);
  }
}

function createBranchFixture() {
  const base = new Osm({ id: "property-routing-base" });
  base.nodes.addNode({ id: 1, lon: 0, lat: 0 });
  base.nodes.addNode({ id: 2, lon: 0.001, lat: 0 });
  base.ways.addWay({
    id: 10,
    refs: [1, 2],
    tags: {
      highway: "footway",
      name: "Base path",
      surface: "paved",
      description: "Existing survey description",
    },
  });
  base.buildIndexes();
  base.buildSpatialIndexes();

  const patch = new Osm({ id: "property-routing-patch" });
  for (const node of [
    { id: 101, lon: 0, lat: 0.000005 },
    { id: 102, lon: 0.0005, lat: 0.000005 },
    { id: 103, lon: 0.001, lat: 0.000005 },
    { id: 104, lon: -0.001, lat: 0.001005 },
    { id: 105, lon: 0.002, lat: 0.001005 },
  ]) {
    patch.nodes.addNode(node);
  }
  patch.ways.addWay({
    id: 20,
    refs: [101, 102, 103],
    tags: { highway: "footway", name: "Imported path", surface: "gravel" },
  });
  patch.ways.addWay({ id: 21, refs: [104, 101], tags: { highway: "footway" } });
  patch.ways.addWay({ id: 22, refs: [103, 105], tags: { highway: "footway" } });
  patch.relations.addRelation({
    id: 30,
    members: [
      { type: "way", ref: 22, role: "east" },
      { type: "way", ref: 21, role: "west" },
    ],
    tags: { type: "collection", name: "Imported approaches" },
  });
  patch.buildIndexes();
  patch.buildSpatialIndexes();
  return { base, patch };
}

function topology(osm: Osm) {
  return {
    nodes: [...osm.nodes.sorted()].map(({ id, lon, lat }) => ({ id, lon, lat })),
    ways: [...osm.ways.sorted()].map(({ id, refs }) => ({ id, refs })),
    relations: [...osm.relations.sorted()].map(({ id, members }) => ({ id, members })),
  };
}

function expectBranchRoute(osm: Osm) {
  expect(osm.ways.getById(20)?.refs).toEqual([101, 102, 103]);
  expect(osm.ways.getById(21)?.refs).toEqual([104, 101]);
  expect(osm.ways.getById(22)?.refs).toEqual([103, 105]);
  expect(osm.relations.getById(30)?.members).toEqual([
    { type: "way", ref: 22, role: "east" },
    { type: "way", ref: 21, role: "west" },
  ]);
  const report = new RoutingTestHarness(osm).run({
    id: "imported-branch-to-branch",
    description: "Walk between imported branches through their matched trunk",
    mode: "walk",
    metric: "distance",
    from: { nodeId: 104 },
    to: { nodeId: 105 },
    expect: { reachable: true, requiredWayIds: [21, 20, 22] },
  });
  expect(report.from?.nodeId).toBe(104);
  expect(report.to?.nodeId).toBe(105);
  expect(report.reachable).toBe(true);
  expect(report.algorithmAgreement).toBe(true);
  expect(report.path?.wayIds).toEqual([21, 20, 22]);
}

async function expectPreservedResult(baseline: Osm, result: Osm) {
  const reloaded = await fromPbf(await toPbfBuffer(result), { id: `${result.id}-reloaded` });
  for (const osm of [result, reloaded]) {
    expectBranchRoute(osm);
    expect(topology(osm)).toEqual(topology(baseline));
    expect(osm.ways.getById(10)?.tags).toEqual({
      highway: "footway",
      name: "Imported path",
      surface: "paved",
      description: "Existing survey description",
    });
    for (const wayId of [20, 21, 22]) {
      expect(osm.ways.getById(wayId)?.tags).toEqual(baseline.ways.getById(wayId)?.tags);
    }
  }
}

describe("property copying preserves imported branch routes", () => {
  it("retains a selected base value when the imported way does not have that tag", async () => {
    const { base, patch } = createBranchFixture();
    const baseline = await merge(base, patch, ordinaryOptions, () => {});
    const result = await merge(
      base,
      patch,
      {
        ...ordinaryOptions,
        conflation: { ...propertyOptions, propertyKeys: ["name", "description"] },
      },
      () => {},
    );
    await expectPreservedResult(baseline, result);
  });

  it.each(["automatic", "individual"] as const)(
    "preserves topology through the public merge API with %s decisions",
    async (mode) => {
      const { base, patch } = createBranchFixture();
      expectBranchRoute(patch);
      const baseline = await merge(base, patch, ordinaryOptions, () => {});
      expectBranchRoute(baseline);
      const result = await merge(
        base,
        patch,
        {
          ...ordinaryOptions,
          conflation: {
            ...propertyOptions,
            automatic: mode === "automatic" ? "high-confidence" : "none",
            decisions: mode === "individual" ? [trunkDecision] : [],
          },
        },
        () => {},
      );
      await expectPreservedResult(baseline, result);
    },
  );

  it.each(["automatic", "individual", "bulk"] as const)(
    "preserves topology after worker generation and application with %s decisions",
    async (mode) => {
      const { base, patch } = createBranchFixture();
      expectBranchRoute(patch);
      const baseline = await merge(base, patch, ordinaryOptions, () => {});
      expectBranchRoute(baseline);
      const worker = new TestWorker();
      worker.setOsm(base);
      worker.setOsm(patch);
      worker.discoverConflation(base.id, patch.id, {
        ...propertyOptions,
        automatic: mode === "automatic" ? "high-confidence" : "none",
      });
      if (mode === "individual") {
        worker.setConflationDecision(base.id, trunkDecision);
      } else if (mode === "bulk") {
        const applied = worker.applyConflationBulkDecision(base.id, {
          action: "transfer-properties",
          filter: { entityType: "way" },
        });
        expect(applied.decisions).toContainEqual(trunkDecision);
      }
      worker.generateConflationChangeset(base.id, ordinaryOptions);
      worker.applyChangesAndReplace(base.id);
      await expectPreservedResult(baseline, worker.getOsm(base.id));
    },
  );
});
