import { Osm } from "@osmix/core";
import { createMockBaseOsm, createMockPatchOsm } from "@osmix/core/mocks";
import { describe, expect, it } from "vitest";

import { OsmixWorker } from "../src/worker";

class TestWorker extends OsmixWorker {
  setOsm(id: string, osm: Osm) {
    this.set(id, osm);
  }

  getOsm(id: string) {
    return this.get(id);
  }
}

function withId(osm: Osm, id: string) {
  return new Osm({ ...osm.transferables(), id });
}

function createParallelFootway(
  id: string,
  nodeId: number,
  wayId: number,
  lat: number,
  name: string,
) {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: nodeId, lon: 0, lat });
  osm.nodes.addNode({ id: nodeId + 1, lon: 0.001, lat });
  osm.nodes.buildIndex();
  osm.ways.addWay({
    id: wayId,
    refs: [nodeId, nodeId + 1],
    tags: { highway: "footway", name },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function createMixedParallelNetwork(
  id: string,
  nodeId: number,
  wayId: number,
  offset: number,
  namePrefix: string,
) {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: nodeId, lon: 0, lat: offset });
  osm.nodes.addNode({ id: nodeId + 1, lon: 0.001, lat: offset });
  osm.nodes.addNode({ id: nodeId + 2, lon: 0, lat: 0.01 + offset });
  osm.nodes.addNode({ id: nodeId + 3, lon: 0.001, lat: 0.01 + offset });
  osm.nodes.buildIndex();
  osm.ways.addWay({
    id: wayId,
    refs: [nodeId, nodeId + 1],
    tags: { highway: "footway", name: `${namePrefix} path` },
  });
  osm.ways.addWay({
    id: wayId + 1,
    refs: [nodeId + 2, nodeId + 3],
    tags: { highway: "residential", name: `${namePrefix} street` },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("OsmixWorker registries", () => {
  it("stores reserved and ordinary IDs without prototype collisions", () => {
    const worker = new TestWorker();
    const ids = ["__proto__", "constructor", "toString", "ordinary"];

    for (const id of ids) {
      worker.setOsm(id, withId(createMockBaseOsm(), id));
      worker.buildRoutingGraph(id);
    }

    expect(ids.map((id) => worker.has(id))).toEqual([true, true, true, true]);
    expect(ids.map((id) => worker.isReady(id))).toEqual([true, true, true, true]);
    expect(ids.map((id) => worker.hasRoutingGraph(id))).toEqual([true, true, true, true]);
    expect(worker.getOsm("__proto__").id).toBe("__proto__");

    worker.delete("__proto__");

    expect(worker.has("__proto__")).toBe(false);
    expect(worker.hasRoutingGraph("__proto__")).toBe(false);
    expect(worker.has("constructor")).toBe(true);
    expect(worker.has("toString")).toBe(true);
    expect(worker.has("ordinary")).toBe(true);
    expect(() => worker.getOsm("missing")).toThrow("OSM not found for id: missing");
  });

  it("keeps changeset filtering and cleanup isolated for reserved IDs", async () => {
    const worker = new TestWorker();
    const registries = [
      ["__proto__", "patch-proto"],
      ["constructor", "patch-constructor"],
      ["toString", "patch-to-string"],
    ] as const;

    for (const [baseId, patchId] of registries) {
      worker.setOsm(baseId, withId(createMockBaseOsm(), baseId));
      worker.setOsm(patchId, withId(createMockPatchOsm(), patchId));
      await worker.generateChangeset(baseId, patchId, { directMerge: true });
    }

    worker.setChangesetFilters(["create"], ["way"]);
    for (const [baseId] of registries) {
      const page = worker.getChangesetPage(baseId, 0, 100);
      expect(page.totalPages).toBe(1);
      expect(page.changes?.every((change) => change.changeType === "create")).toBe(true);
      expect(page.changes?.every((change) => "refs" in change.entity)).toBe(true);
      expect(page.changes?.map((change) => change.entity.id)).toEqual([2, 3, 4]);
    }

    worker.applyChangesAndReplace("__proto__");

    expect(() => worker.getChangesetPage("__proto__", 0, 10)).toThrow("No active changeset");
    expect(() => worker.getChangesetPage("missing", 0, 10)).toThrow("No active changeset");
    expect(worker.getChangesetPage("constructor", 0, 100).changes?.length).toBeGreaterThan(0);
    expect(worker.has("__proto__")).toBe(true);
    expect(worker.has("constructor")).toBe(true);
    expect(worker.has("toString")).toBe(true);
  });

  it("validates initial decisions and filters explicitly for unmatched targets", () => {
    const worker = new TestWorker();
    const base = withId(createMockBaseOsm(), "conflation-base");
    const patch = withId(createMockPatchOsm(), "conflation-patch");
    base.buildSpatialIndexes();
    patch.buildSpatialIndexes();
    worker.setOsm(base.id, base);
    worker.setOsm(patch.id, patch);

    expect(() =>
      worker.discoverConflation(base.id, patch.id, {
        propertyKeys: ["crossing"],
        attachNetwork: true,
        decisions: [{ candidateId: "node:missing->none", action: "reject" }],
      }),
    ).toThrow("Unknown conflation candidate: node:missing->none");

    worker.discoverConflation(base.id, patch.id, {
      propertyKeys: ["crossing"],
      attachNetwork: true,
    });
    worker.setConflationFilter(base.id, { targetId: null });
    const page = worker.getConflationPage(base.id, 0, 100);

    expect(page.totalCandidates).toBeGreaterThan(0);
    expect(page.candidates.every((candidate) => candidate.targetId === null)).toBe(true);

    const candidateId = page.candidates[0]!.id;
    const validDecision = { candidateId, action: "reject" as const };
    worker.setConflationDecisions(base.id, [validDecision]);
    worker.generateConflationChangeset(base.id, {
      directMerge: true,
      deduplicateNodes: true,
      deduplicateWays: true,
    });
    const generatedChanges = worker.getChangesetPage(base.id, 0, 100).changes;

    expect(() => worker.setConflationDecisions(base.id, [validDecision, validDecision])).toThrow(
      `Duplicate conflation decision for ${candidateId}`,
    );
    expect(() =>
      worker.setConflationDecision(base.id, {
        candidateId,
        action: "invalid",
      } as never),
    ).toThrow(`Invalid conflation decision action for ${candidateId}`);
    expect(() =>
      worker.setConflationDecision(base.id, {
        candidateId,
        action: "accept",
        attachNetwork: "yes",
      } as never),
    ).toThrow(`Conflation attachNetwork must be a boolean for ${candidateId}`);
    expect(() => worker.setConflationDecision(base.id, null as never)).toThrow(
      "Conflation decision must be an object",
    );
    expect(() =>
      worker.discoverConflation(base.id, patch.id, {
        propertyKeys: ["crossing"],
        attachNetwork: true,
        decisions: [{ candidateId, action: "invalid" } as never],
      }),
    ).toThrow(`Invalid conflation decision action for ${candidateId}`);
    expect(() =>
      worker.discoverConflation(base.id, patch.id, {
        propertyKeys: ["crossing"],
        attachNetwork: true,
        decisions: null,
      } as never),
    ).toThrow("Conflation decisions must be an array");

    worker.setConflationFilter(base.id, {});
    expect(worker.getConflationPage(base.id, 0, 100).candidates[0]?.decision).toEqual(
      validDecision,
    );
    expect(worker.getChangesetPage(base.id, 0, 100).changes).toEqual(generatedChanges);
  });

  it("applies filtered bulk decisions across pages and invalidates generated changes", () => {
    const worker = new TestWorker();
    const base = createMixedParallelNetwork("bulk-base", 1, 10, 0, "Base");
    const patch = createMixedParallelNetwork("bulk-patch", 11, 20, 0.000004, "Imported");
    worker.setOsm(base.id, base);
    worker.setOsm(patch.id, patch);
    worker.discoverConflation(base.id, patch.id, {
      propertyKeys: ["name"],
      attachNetwork: false,
    });
    worker.setConflationFilter(base.id, { entityType: "way" });

    const firstPage = worker.getConflationPage(base.id, 0, 1);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.bulkActions["transfer-properties"]).toMatchObject({
      filteredCandidates: 2,
      eligibleCandidates: 2,
      changedCandidates: 2,
    });

    worker.generateConflationChangeset(base.id, {
      directMerge: true,
      deduplicateNodes: true,
      deduplicateWays: true,
    });
    const accepted = worker.applyConflationBulkDecision(base.id, {
      action: "transfer-properties",
      filter: { entityType: "way" },
    });
    expect(accepted.decisions).toHaveLength(2);
    expect(accepted.summary.accepted).toBe(2);
    expect(() => worker.getChangesetPage(base.id, 0, 100)).toThrow("No active changeset");

    worker.setConflationFilter(base.id, { status: "accepted" });
    expect(worker.getConflationPage(base.id, 0, 100).totalCandidates).toBe(2);
    const rejected = worker.applyConflationBulkDecision(base.id, {
      action: "reject",
      filter: { status: "accepted" },
    });
    expect(rejected.preview).toMatchObject({
      filteredCandidates: 2,
      changedCandidates: 2,
      overriddenDecisions: 2,
    });
    expect(rejected.summary.rejected).toBe(2);
    expect(worker.getConflationPage(base.id, 0, 100).totalCandidates).toBe(0);
    expect(() =>
      worker.applyConflationBulkDecision(base.id, {
        action: "invalid",
        filter: {},
      } as never),
    ).toThrow("Invalid conflation bulk action");
    expect(worker.getConflationSummary(base.id).rejected).toBe(2);
  });

  it("generates diagnostics when way candidates have no network action", () => {
    const worker = new TestWorker();
    const base = createParallelFootway("footway-base", 1, 10, 0, "Base path");
    const patch = createParallelFootway("footway-patch", 11, 20, 0.000004, "Imported path");
    worker.setOsm(base.id, base);
    worker.setOsm(patch.id, patch);

    worker.discoverConflation(base.id, patch.id, {
      propertyKeys: ["name"],
      attachNetwork: false,
    });
    const wayCandidates = worker
      .getConflationPage(base.id, 0, 100)
      .candidates.filter((candidate) => candidate.entityType === "way");
    expect(wayCandidates).toHaveLength(1);
    expect(wayCandidates[0]?.networkAttachment).toBeNull();

    const result = worker.generateConflationChangeset(base.id, {
      directMerge: true,
      deduplicateNodes: true,
      deduplicateWays: true,
    });
    expect(result.stats.totalChanges).toBeGreaterThan(0);
    expect(result.routing.car.delta).toMatchObject({
      routableNodes: 0,
      edges: 0,
      components: 0,
    });
  });

  it("returns defensive candidate, decision, filter, and summary snapshots", () => {
    const worker = new TestWorker();
    const base = createParallelFootway("snapshot-base", 1, 10, 0, "Base path");
    const patch = createParallelFootway("snapshot-patch", 11, 20, 0.000004, "Imported path");
    worker.setOsm(base.id, base);
    worker.setOsm(patch.id, patch);
    const summary = worker.discoverConflation(base.id, patch.id, {
      propertyKeys: ["name"],
      attachNetwork: true,
    });
    const initialPage = worker.getConflationPage(base.id, 0, 100);
    const initialWay = initialPage.candidates.find((candidate) => candidate.entityType === "way")!;
    const initialNode = initialPage.candidates.find(
      (candidate) => candidate.entityType === "node",
    )!;
    worker.setConflationDecision(base.id, {
      candidateId: initialWay.id,
      action: "accept",
      transferProperties: true,
    });

    const filter: Parameters<typeof worker.setConflationFilter>[1] = { status: undefined };
    worker.setConflationFilter(base.id, filter);
    filter.status = "blocked";
    const page = worker.getConflationPage(base.id, 0, 100);
    const way = page.candidates.find((candidate) => candidate.id === initialWay.id)!;
    const node = page.candidates.find((candidate) => candidate.id === initialNode.id)!;
    way.reasons.push("protected-tag");
    way.propertyTransfer.reasons.push("routing-property");
    way.evidence.sourceRoutingFamilies.push("motor-road");
    way.evidence.targetRoutingFamilies.push("motor-road");
    way.evidence.tagDiff[0]!.key = "corrupted";
    way.evidence.endpointDistancesMeters![0] = 999;
    way.decision!.action = "reject";
    node.networkAttachment!.reasons.push("grade-conflict");
    node.evidence.patchWayIds!.push(999);
    page.bulkActions.reject.changedCandidates = 0;
    summary.total = 0;

    const freshPage = worker.getConflationPage(base.id, 0, 100);
    const freshWay = freshPage.candidates.find((candidate) => candidate.id === initialWay.id)!;
    const freshNode = freshPage.candidates.find((candidate) => candidate.id === initialNode.id)!;
    expect(freshPage.candidates.every((candidate) => candidate.status === "automatic")).toBe(true);
    expect(freshWay.reasons).not.toContain("protected-tag");
    expect(freshWay.propertyTransfer.reasons).not.toContain("routing-property");
    expect(freshWay.evidence.sourceRoutingFamilies).not.toContain("motor-road");
    expect(freshWay.evidence.targetRoutingFamilies).not.toContain("motor-road");
    expect(freshWay.evidence.tagDiff[0]?.key).toBe("name");
    expect(freshWay.evidence.endpointDistancesMeters?.[0]).toBeLessThan(1);
    expect(freshWay.decision?.action).toBe("accept");
    expect(freshNode.networkAttachment?.reasons).not.toContain("grade-conflict");
    expect(freshNode.evidence.patchWayIds).not.toContain(999);
    expect(freshPage.bulkActions.reject.changedCandidates).toBeGreaterThan(0);
    expect(worker.getConflationSummary(base.id).total).toBeGreaterThan(0);

    worker.generateConflationChangeset(base.id, {
      directMerge: true,
      deduplicateNodes: true,
      deduplicateWays: true,
    });
    worker.applyChangesAndReplace(base.id);
    expect(worker.getOsm(base.id).ways.getById(10)?.tags?.["name"]).toBe("Imported path");
  });

  it("allows automatic pedestrian attachment only when the CAR graph is unchanged", () => {
    const worker = new TestWorker();
    const base = createParallelFootway("walk-base", 1, 10, 0, "Base path");
    const patch = createParallelFootway("walk-patch", 11, 20, 0.000004, "Imported path");
    worker.setOsm(base.id, base);
    worker.setOsm(patch.id, patch);
    worker.discoverConflation(base.id, patch.id, {
      propertyKeys: ["name"],
      attachNetwork: true,
    });

    const result = worker.generateConflationChangeset(base.id, {
      directMerge: true,
      deduplicateNodes: true,
      deduplicateWays: true,
    });

    expect(result.routing.car.delta).toMatchObject({
      routableNodes: 0,
      edges: 0,
      components: 0,
    });
    expect(result.routing.walk.delta.components).toBeLessThan(0);
  });

  it("isolates the automatic WALK guard from unrelated CAR way property suppression", () => {
    const worker = new TestWorker();
    const base = createMixedParallelNetwork("mixed-base", 1, 10, 0, "Base");
    const patch = createMixedParallelNetwork("mixed-patch", 11, 20, 0.000004, "Imported");
    worker.setOsm(base.id, base);
    worker.setOsm(patch.id, patch);
    worker.discoverConflation(base.id, patch.id, {
      propertyKeys: ["name"],
      attachNetwork: true,
    });

    const result = worker.generateConflationChangeset(base.id, {
      directMerge: true,
      deduplicateNodes: true,
      deduplicateWays: true,
    });

    expect(result.routing.car.delta.edges).toBeLessThan(0);
    expect(result.routing.walk.delta.components).toBeLessThan(0);
  });
});
