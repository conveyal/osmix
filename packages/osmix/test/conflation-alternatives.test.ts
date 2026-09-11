import * as Comlink from "comlink";
import { describe, expect, it } from "vitest";

import { Osm, type OsmConflationDecision, OsmixRemote, OsmixWorker } from "../src/index";

const options = { propertyKeys: ["name"], attachNetwork: false };
const grouped = { groupBySource: true };
const first: OsmConflationDecision = {
  candidateId: "node:101->1",
  action: "accept",
  transferProperties: true,
  attachNetwork: false,
};
const second: OsmConflationDecision = { ...first, candidateId: "node:101->2" };
const unrelated: OsmConflationDecision = { candidateId: "node:102->3", action: "reject" };

function inputs(twoAmbiguousSources = false) {
  const base = new Osm({ id: "alternatives-base" });
  for (const node of [
    { id: 1, lon: -0.000003, lat: 0, tags: { name: "West entrance" } },
    { id: 2, lon: 0.000003, lat: 0, tags: { name: "East entrance" } },
    { id: 3, lon: 0.01, lat: 0, tags: { name: "Other entrance" } },
  ])
    base.nodes.addNode(node);
  if (twoAmbiguousSources)
    base.nodes.addNode({ id: 6, lon: 0.010006, lat: 0, tags: { name: "Other alternative" } });
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

  seedLegacyDecisions(baseId: string, decisions: OsmConflationDecision[]) {
    // Reproduce a session created before the invariant was enforced at the API boundary.
    const session = this["conflations"].get(baseId);
    if (!session) throw Error("Expected an active review");
    session.decisions = new Map(decisions.map((decision) => [decision.candidateId, decision]));
  }
}

class RecoveryRemote extends OsmixRemote {
  async seedLegacyReviewForTest(baseId: string, decisions: OsmConflationDecision[]) {
    await this.getWorker().restoreConflationReview(baseId, decisions);
    const state = this["activeConflations"].get(baseId);
    if (!state) throw Error("Expected a retained review");
    state.decisions = structuredClone(decisions);
  }

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
  worker.discoverConflation(base.id, patch.id, options);
  return { worker, base, patch };
}

function reviewState(worker: OsmixWorker, baseId: string) {
  return {
    summary: worker.getConflationSummary(baseId),
    page: worker.getConflationPage(baseId, 0, 10),
    preview: worker.getChangesetPage(baseId, 0, 100),
  };
}

describe("alternative target review", () => {
  it("keeps alternatives together in opt-in pages while preserving flat pagination", () => {
    const { worker, base } = setup();
    const flat = worker.getConflationPage(base.id, 0, 1);
    expect(flat.candidates.map((candidate) => candidate.id)).toEqual(["node:101->1"]);
    expect(flat).toMatchObject({ totalCandidates: 3, totalPages: 3, pageSize: 1 });
    expect(flat).not.toHaveProperty("groups");
    expect(flat.candidates[0]).not.toHaveProperty("matchesFilter");
    expect(worker.getConflationPage(base.id, 1, 1).candidates[0]?.id).toBe("node:101->2");

    const page = worker.getConflationPage(base.id, 0, 1, grouped);
    expect(page).toMatchObject({ totalCandidates: 3, totalSources: 2, totalPages: 2, pageSize: 1 });
    expect(page.groups).toEqual([
      { entityType: "node", sourceId: 101, candidateIds: ["node:101->1", "node:101->2"] },
    ]);
    expect(page.candidates.map((candidate) => [candidate.id, candidate.matchesFilter])).toEqual([
      ["node:101->1", true],
      ["node:101->2", true],
    ]);
    const next = worker.getConflationPage(base.id, 1, 1, grouped);
    expect(next.candidates.map((candidate) => candidate.id)).toEqual(["node:102->3"]);
    expect(next.groups).toEqual([
      { entityType: "node", sourceId: 102, candidateIds: ["node:102->3"] },
    ]);
    const empty = worker.getConflationPage(base.id, 2, 1, grouped);
    expect(empty.candidates).toEqual([]);
    expect(empty.groups).toEqual([]);
  });

  it("includes filtered-out alternatives as context without inflating candidate or bulk counts", () => {
    const { worker, base } = setup();
    worker.setConflationDecisions(base.id, [first, unrelated]);
    for (const filter of [{ status: "accepted" as const }, { targetId: 1 }]) {
      worker.setConflationFilter(base.id, filter);
      const page = worker.getConflationPage(base.id, 0, 1, grouped);
      expect(page).toMatchObject({ totalCandidates: 1, totalSources: 1, totalPages: 1 });
      expect(page.candidates.map((candidate) => [candidate.id, candidate.matchesFilter])).toEqual([
        ["node:101->1", true],
        ["node:101->2", false],
      ]);
      expect(page.bulkActions["transfer-properties"]).toMatchObject({
        filteredCandidates: 1,
        eligibleCandidates: 0,
        changedCandidates: 0,
        skippedCandidates: 1,
      });
      expect(page.bulkActions.reject.filteredCandidates).toBe(1);
      expect(worker.getConflationPage(base.id, 0, 10).candidates).toHaveLength(1);
    }
    worker.setConflationFilter(base.id, { sourceId: 102 });
    expect(worker.getConflationPage(base.id, 0, 1, grouped).groups?.[0]?.sourceId).toBe(102);
  });

  it.each(["single", "full"] as const)(
    "rejects a conflicting %s update before changing review or generated preview",
    (kind) => {
      const { worker, base } = setup();
      worker.setConflationDecisions(base.id, [first, unrelated]);
      worker.generateConflationChangeset(base.id, { directMerge: true });
      const before = reviewState(worker, base.id);
      const mutate = () => {
        if (kind === "single") return worker.setConflationDecision(base.id, second);
        return worker.setConflationDecisions(base.id, [first, second]);
      };
      expect(mutate).toThrow(/(?:node.?101|node 101)/i);
      expect(reviewState(worker, base.id)).toEqual(before);
      worker.generateConflationChangeset(base.id, { directMerge: true });
      expect(worker.getChangesetPage(base.id, 0, 100)).toEqual(before.preview);
    },
  );

  it("skips ambiguous alternatives in bulk even when one target is already selected", () => {
    const { worker, base } = setup();
    for (const decisions of [[], [first, unrelated]]) {
      worker.setConflationDecisions(base.id, decisions);
      worker.generateConflationChangeset(base.id, { directMerge: true });
      const before = reviewState(worker, base.id);
      const result = worker.applyConflationBulkDecision(base.id, {
        action: "transfer-properties",
        filter: { sourceId: 101 },
      });
      expect(result.preview).toMatchObject({
        filteredCandidates: 2,
        eligibleCandidates: 0,
        changedCandidates: 0,
        skippedCandidates: 2,
      });
      expect(reviewState(worker, base.id)).toEqual(before);
    }
  });

  it("preserves conflict location across actual Comlink calls without changing the valid preview", async () => {
    const { worker, base } = setup();
    worker.setConflationDecisions(base.id, [first, unrelated]);
    worker.generateConflationChangeset(base.id, { directMerge: true });
    const before = reviewState(worker, base.id);
    const { port1, port2 } = new MessageChannel();
    Comlink.expose(worker, port1);
    const remote = Comlink.wrap<OsmixWorker>(port2);
    try {
      await expect(remote.setConflationDecision(base.id, second)).rejects.toMatchObject({
        conflict: {
          entityType: "node",
          sourceId: 101,
          candidateIds: [first.candidateId, second.candidateId],
          message: expect.stringMatching(/node.?101/i),
        },
      });
      expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(before.preview);
      expect(reviewState(worker, base.id)).toEqual(before);
    } finally {
      port1.close();
      port2.close();
    }
  });

  it("keeps legacy conflicts reviewable and permits only explicit source correction", () => {
    const { worker, base } = setup();
    worker.setConflationDecisions(base.id, [first, unrelated]);
    worker.generateConflationChangeset(base.id, { directMerge: true });
    const preview = worker.getChangesetPage(base.id, 0, 100);
    worker.seedLegacyDecisions(base.id, [first, second, unrelated]);
    const page = worker.getConflationPage(base.id, 0, 1, grouped);
    expect(page.candidates.map((candidate) => candidate.decision)).toEqual([first, second]);
    expect(page.validationConflict).toMatchObject({
      entityType: "node",
      sourceId: 101,
      candidateIds: [first.candidateId, second.candidateId],
    });
    for (const action of ["transfer-properties", "attach-network", "reject"] as const) {
      expect(page.bulkActions[action]).toMatchObject({
        filteredCandidates: 3,
        eligibleCandidates: 0,
        changedCandidates: 0,
        skippedCandidates: 3,
      });
      expect(() => worker.applyConflationBulkDecision(base.id, { action, filter: {} })).toThrow(
        /node.?101/i,
      );
    }
    expect(() => worker.generateConflationChangeset(base.id, { directMerge: true })).toThrow(
      /node.?101/i,
    );
    expect(worker.getChangesetPage(base.id, 0, 100)).toEqual(preview);
    expect(worker.getConflationPage(base.id, 0, 1, grouped)).toEqual(page);

    const fixed = worker.setConflationSourceDecision(
      base.id,
      { entityType: "node", sourceId: 101 },
      second,
    );
    expect(fixed.decisions).toEqual(
      expect.arrayContaining([
        { candidateId: first.candidateId, action: "reject" },
        second,
        unrelated,
      ]),
    );
    expect(worker.getConflationPage(base.id, 0, 1, grouped)).not.toHaveProperty(
      "validationConflict",
    );
    worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(
      worker.getChangesetPage(base.id, 0, 100).changes?.find((change) => change.entity.id === 2),
    ).toMatchObject({
      changeType: "modify",
      entity: { tags: { name: "Imported entrance" } },
    });
  });

  it("can leave a source unmatched and rejects a mismatched replacement without losing other choices", () => {
    const { worker, base } = setup();
    worker.setConflationDecisions(base.id, [first, unrelated]);
    worker.generateConflationChangeset(base.id, { directMerge: true });
    const before = reviewState(worker, base.id);
    expect(() =>
      worker.setConflationSourceDecision(base.id, { entityType: "node", sourceId: 101 }, unrelated),
    ).toThrow();
    expect(reviewState(worker, base.id)).toEqual(before);
    const result = worker.setConflationSourceDecision(
      base.id,
      { entityType: "node", sourceId: 101 },
      null,
    );
    expect(result.decisions).toEqual(
      expect.arrayContaining([
        { candidateId: first.candidateId, action: "reject" },
        { candidateId: second.candidateId, action: "reject" },
        unrelated,
      ]),
    );
    worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(
      worker
        .getChangesetPage(base.id, 0, 100)
        .changes?.every((change) => change.changeType === "create"),
    ).toBe(true);
  });

  it("preserves valid decisions and exact preview through rejected updates and remote recovery", async () => {
    const { base, patch } = inputs();
    using remote = new RecoveryRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    await remote.discoverConflation(base.id, patch.id, options);
    await remote.setConflationDecisions(base.id, [first, unrelated]);
    await remote.setConflationFilter(base.id, { status: "accepted" });
    await remote.generateConflationChangeset(base.id, { directMerge: true });
    const page = await remote.getConflationPage(base.id, 0, 1, grouped);
    const preview = await remote.getChangesetPage(base.id, 0, 100);
    await expect(remote.setConflationDecision(base.id, second)).rejects.toThrow(/node.?101/i);
    await expect(remote.setConflationDecisions(base.id, [first, second])).rejects.toThrow(
      /node.?101/i,
    );
    expect(
      (
        await remote.applyConflationBulkDecision(base.id, {
          action: "transfer-properties",
          filter: { targetId: 2 },
        })
      ).preview,
    ).toMatchObject({ eligibleCandidates: 0, changedCandidates: 0, skippedCandidates: 1 });
    expect(await remote.getConflationPage(base.id, 0, 1, grouped)).toEqual(page);
    expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(preview);

    await remote.restartForTest();

    expect(await remote.getConflationPage(base.id, 0, 1, grouped)).toEqual(page);
    expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(preview);
    const replaced = await remote.setConflationSourceDecision(
      base.id,
      { entityType: "node", sourceId: 101 },
      second,
    );
    expect(replaced.decisions).toEqual(
      expect.arrayContaining([
        { candidateId: first.candidateId, action: "reject" },
        second,
        unrelated,
      ]),
    );
    await remote.generateConflationChangeset(base.id, { directMerge: true });
    const replacement = await remote.getChangesetPage(base.id, 0, 100);
    expect(replacement.changes?.find((change) => change.entity.id === 1)).toBeUndefined();
    expect(replacement.changes?.find((change) => change.entity.id === 2)).toMatchObject({
      changeType: "modify",
      entity: { tags: { name: "Imported entrance" } },
    });
    expect(replacement.changes?.find((change) => change.entity.id === 3)).toBeUndefined();
    await remote.restartForTest();
    expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(replacement);
    await remote.setConflationFilter(base.id, {});
    const restored = await remote.getConflationPage(base.id, 0, 10, grouped);
    expect(
      restored.candidates.find((candidate) => candidate.id === first.candidateId)?.decision,
    ).toEqual({ candidateId: first.candidateId, action: "reject" });
    expect(
      restored.candidates.find((candidate) => candidate.id === second.candidateId)?.decision,
    ).toEqual(second);
    expect(
      restored.candidates.find((candidate) => candidate.id === unrelated.candidateId)?.decision,
    ).toEqual(unrelated);
    await remote.applyChangesAndReplace(base.id);
    const result = await remote.get(base.id);
    const expected = [...base.nodes.sorted(), ...patch.nodes.sorted()].map((node) =>
      node.id === 2 ? { ...node, tags: { name: "Imported entrance" } } : node,
    );
    expect([...result.nodes.sorted()]).toEqual(expected);
    expect([...result.ways.sorted()]).toEqual([]);
    expect([...result.relations.sorted()]).toEqual([]);
  });

  it("restores a partial legacy correction and permits the remaining source to be repaired", async () => {
    const { base, patch } = inputs(true);
    using remote = new RecoveryRemote();
    await remote.initializeWorkerPool(1, undefined, undefined, true);
    await remote.transferIn(base);
    await remote.transferIn(patch);
    await remote.discoverConflation(base.id, patch.id, options);
    const third: OsmConflationDecision = { candidateId: "node:102->3", action: "accept" };
    const fourth: OsmConflationDecision = { candidateId: "node:102->6", action: "accept" };
    await remote.seedLegacyReviewForTest(base.id, [first, second, third, fourth]);
    expect(
      (await remote.getConflationPage(base.id, 0, 1, grouped)).validationConflict?.sourceId,
    ).toBe(101);
    const partiallyFixed = await remote.setConflationSourceDecision(
      base.id,
      { entityType: "node", sourceId: 101 },
      second,
    );
    expect(partiallyFixed.decisions).toEqual(expect.arrayContaining([third, fourth]));
    await remote.setConflationFilter(base.id, { sourceId: 102 });
    const unresolved = await remote.getConflationPage(base.id, 0, 1, grouped);
    expect(unresolved.validationConflict?.sourceId).toBe(102);
    await expect(remote.setConflationDecisions(base.id, partiallyFixed.decisions)).rejects.toThrow(
      /node.?102/i,
    );
    await expect(
      remote.generateConflationChangeset(base.id, { directMerge: true }),
    ).rejects.toThrow(/node.?102/i);

    await remote.restartForTest();

    expect(await remote.getConflationPage(base.id, 0, 1, grouped)).toEqual(unresolved);
    const fixed = await remote.setConflationSourceDecision(
      base.id,
      { entityType: "node", sourceId: 102 },
      null,
    );
    expect(fixed.decisions).toContainEqual(second);
    expect(fixed.decisions).toEqual(
      expect.arrayContaining([
        { candidateId: third.candidateId, action: "reject" },
        { candidateId: fourth.candidateId, action: "reject" },
      ]),
    );
    await remote.generateConflationChangeset(base.id, { directMerge: true });
    const preview = await remote.getChangesetPage(base.id, 0, 100);
    expect(preview.changes?.find((change) => change.entity.id === 2)).toMatchObject({
      changeType: "modify",
      entity: { tags: { name: "Imported entrance" } },
    });
    await remote.restartForTest();
    expect(await remote.getChangesetPage(base.id, 0, 100)).toEqual(preview);
    await remote.applyChangesAndReplace(base.id);
    const result = await remote.get(base.id);
    expect([...result.nodes.sorted()]).toEqual(
      [...base.nodes.sorted(), ...patch.nodes.sorted()].map((node) =>
        node.id === 2 ? { ...node, tags: { name: "Imported entrance" } } : node,
      ),
    );
    expect([...result.ways.sorted()]).toEqual([]);
    expect([...result.relations.sorted()]).toEqual([]);
  });
});
