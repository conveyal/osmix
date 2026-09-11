import { describe, expect, it } from "vitest";

import { fromPbf, merge, Osm, toPbfBuffer } from "../src/index.ts";
import { OsmixWorker } from "../src/worker.ts";
import { RoutingTestHarness } from "./routing-harness.ts";

class TestWorker extends OsmixWorker {
  setOsm(osm: Osm) {
    this.set(osm.id, osm);
  }

  getOsm(id: string) {
    return this.get(id);
  }
}

function createPortalFixture(
  variant: "plain" | "restriction" | "multiple" | "unsafe" | "grade-conflict",
) {
  const gradeConflict = variant === "grade-conflict";
  const base = new Osm({ id: "junction-base" });
  base.nodes.addNode({ id: 1, lon: -0.001, lat: 0 });
  base.nodes.addNode({ id: 2, lon: 0, lat: 0 });
  const bridgeTags = { highway: "primary", bridge: "yes", layer: "1" };
  base.ways.addWay({
    id: 10,
    refs: gradeConflict ? [1, 2, 3] : [1, 2],
    tags: gradeConflict ? bridgeTags : { highway: "primary" },
  });
  if (gradeConflict) {
    base.nodes.addNode({ id: 3, lon: 0.001, lat: 0 });
    base.nodes.addNode({ id: 4, lon: -0.001, lat: -0.001 });
    base.ways.addWay({ id: 11, refs: [2, 4], tags: bridgeTags });
  }
  base.buildIndexes();
  base.buildSpatialIndexes();

  const patch = new Osm({ id: "junction-patch" });
  for (const node of [
    { id: 5, lon: 0, lat: 0 },
    { id: 6, lon: 0, lat: 0.001 },
    { id: 7, lon: 0.001, lat: 0 },
  ]) {
    patch.nodes.addNode(node);
  }
  patch.ways.addWay({
    id: 20,
    refs: [5, 6],
    tags: gradeConflict ? bridgeTags : { highway: "primary" },
  });
  patch.ways.addWay({
    id: 21,
    refs: [5, 7],
    tags: gradeConflict ? { highway: "primary" } : bridgeTags,
  });
  if (variant === "multiple") {
    patch.nodes.addNode({ id: 8, lon: -0.001, lat: 0.001 });
    patch.ways.addWay({ id: 22, refs: [5, 8], tags: { highway: "primary" } });
  } else if (variant === "unsafe") {
    // This incident way is valid by node identity, but replacing 5 with 2 would collapse it.
    patch.nodes.addNode({ id: 2, lon: 0, lat: 0 });
    patch.ways.addWay({ id: 22, refs: [5, 2], tags: { highway: "primary" } });
  }
  const restrictionFromWays = variant === "plain" ? [] : variant === "multiple" ? [20, 22] : [20];
  for (const [index, fromWayId] of restrictionFromWays.entries()) {
    patch.relations.addRelation({
      id: 100 + index,
      tags: { type: "restriction", restriction: "only_left_turn" },
      members: [
        { type: "way", ref: fromWayId, role: "from" },
        { type: "node", ref: 5, role: "via" },
        { type: "way", ref: 21, role: "to" },
      ],
    });
  }
  patch.buildIndexes();
  patch.buildSpatialIndexes();
  return { base, patch };
}

function expectPortalConnected(osm: Osm, originalPatch: Osm) {
  const surface = osm.ways.getById(20);
  const bridge = osm.ways.getById(21);
  expect(surface).not.toBeNull();
  expect(bridge).not.toBeNull();
  const sharedNodes = surface!.refs.filter((ref) => bridge!.refs.includes(ref));
  expect(sharedNodes.length).toBeGreaterThan(0);
  expect(surface?.refs).toContain(6);
  expect(bridge?.refs).toContain(7);
  expect(bridge?.tags).toEqual({ highway: "primary", bridge: "yes", layer: "1" });

  const report = new RoutingTestHarness(osm).run({
    id: "imported-bridge-entrance",
    description: "Reach the bridge from the existing imported surface approach",
    mode: "car",
    metric: "distance",
    from: { nodeId: 6 },
    to: { nodeId: 7 },
    expect: { reachable: true, requiredWayIds: [20, 21] },
  });
  expect(report.from?.nodeId).toBe(6);
  expect(report.to?.nodeId).toBe(7);
  expect(report.reachable).toBe(true);
  expect(report.algorithmAgreement).toBe(true);
  expect(report.path?.wayIds).toEqual([20, 21]);

  for (const originalRelation of originalPatch.relations) {
    const relation = osm.relations.getById(originalRelation.id);
    expect(relation?.tags).toEqual(originalRelation.tags);
    expect(relation?.members.filter((member) => member.type === "way")).toEqual(
      originalRelation.members.filter((member) => member.type === "way"),
    );
    const via = relation?.members.find((member) => member.role === "via");
    expect(via?.type).toBe("node");
    expect(sharedNodes).toContain(via?.ref);
    for (const member of relation?.members ?? []) {
      if (member.type === "way") {
        expect(osm.ways.getById(member.ref)?.refs).toContain(via?.ref);
      }
    }
  }
  for (const way of osm.ways) {
    expect(new Set(way.refs).size).toBeGreaterThanOrEqual(2);
    expect(way.refs.every((ref, index) => index === 0 || ref !== way.refs[index - 1])).toBe(true);
    expect(way.refs.every((ref) => osm.nodes.ids.has(ref))).toBe(true);
  }
}

async function expectPortalAfterReload(osm: Osm, originalPatch: Osm, junctionId = 2) {
  const reloaded = await fromPbf(await toPbfBuffer(osm), { id: `${osm.id}-reloaded` });
  for (const result of [osm, reloaded]) {
    expectPortalConnected(result, originalPatch);
    expect(result.ways.getById(10)?.refs).toEqual([1, 2]);
    for (const way of originalPatch.ways) {
      expect(result.ways.getById(way.id)?.refs).toEqual(
        way.refs.map((ref) => (ref === 5 ? junctionId : ref)),
      );
    }
    for (const relation of originalPatch.relations) {
      expect(result.relations.getById(relation.id)?.members[1]).toEqual({
        type: "node",
        ref: junctionId,
        role: "via",
      });
    }
  }
  expect([...reloaded.ways.sorted()].map(({ id, refs }) => ({ id, refs }))).toEqual(
    [...osm.ways.sorted()].map(({ id, refs }) => ({ id, refs })),
  );
  expect([...reloaded.relations.sorted()]).toEqual([...osm.relations.sorted()]);
}

describe("intersection creation preserves imported junctions", () => {
  it.each(["plain", "restriction"] as const)(
    "preserves the bridge portal through the public merge API (%s)",
    async (variant) => {
      const { base, patch } = createPortalFixture(variant);
      expectPortalConnected(patch, patch);
      const result = await merge(
        base,
        patch,
        { directMerge: true, createIntersections: true },
        () => {},
      );
      await expectPortalAfterReload(result, patch);
    },
  );

  it("keeps every incident way and restriction together through worker application", async () => {
    const { base, patch } = createPortalFixture("multiple");
    expectPortalConnected(patch, patch);
    const worker = new TestWorker();
    worker.setOsm(base);
    worker.setOsm(patch);
    await worker.generateChangeset(base.id, patch.id, { directMerge: true });
    worker.applyChangesAndReplace(base.id);
    expectPortalConnected(worker.getOsm(base.id), patch);
    await worker.generateChangeset(base.id, patch.id, { createIntersections: true });
    worker.applyChangesAndReplace(base.id);
    await expectPortalAfterReload(worker.getOsm(base.id), patch);
  });

  it("preserves the original junction when substituting an endpoint would collapse an incident way", async () => {
    const { base, patch } = createPortalFixture("unsafe");
    expectPortalConnected(patch, patch);
    const result = await merge(
      base,
      patch,
      { directMerge: true, createIntersections: true },
      () => {},
    );
    await expectPortalAfterReload(result, patch, 5);
  });

  it("keeps valid junctions separate when combining them would connect a surface way to a bridge interior", async () => {
    const { base, patch } = createPortalFixture("grade-conflict");
    const baseline = await merge(base, patch, { directMerge: true }, () => {});
    const result = await merge(
      base,
      patch,
      { directMerge: true, createIntersections: true },
      () => {},
    );
    const reloaded = await fromPbf(await toPbfBuffer(result), {
      id: "separate-junctions-reloaded",
    });

    for (const osm of [baseline, result, reloaded]) {
      expect([...osm.ways.sorted()]).toEqual([...baseline.ways.sorted()]);
      expect([...osm.relations.sorted()]).toEqual([...baseline.relations.sorted()]);
      expect(osm.relations.getById(100)?.members[1]).toEqual({
        type: "node",
        ref: 5,
        role: "via",
      });
      const harness = new RoutingTestHarness(osm);
      for (const [from, to, reachable] of [
        [3, 4, true],
        [6, 7, true],
        [3, 7, false],
      ] as const) {
        const report = harness.run({
          id: `separate-junctions-${from}-${to}`,
          description: "Preserve each original junction without joining different grades",
          mode: "car",
          metric: "distance",
          from: { nodeId: from },
          to: { nodeId: to },
          expect: { reachable },
        });
        expect(report.from?.nodeId).toBe(from);
        expect(report.to?.nodeId).toBe(to);
        expect(report.reachable).toBe(reachable);
        expect(report.algorithmAgreement).toBe(true);
      }
    }
  });
});
