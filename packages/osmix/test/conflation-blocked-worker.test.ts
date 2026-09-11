import { describe, expect, it } from "vitest";

import { merge, Osm } from "../src/index";
import { OsmixWorker } from "../src/worker";
import { createBlockedBridgeFixture, entitySnapshot } from "./conflation-blocked-fixture";

class TestWorker extends OsmixWorker {
  setOsm(osm: Osm) {
    this.set(osm.id, osm);
  }

  getOsm(id: string) {
    return this.get(id);
  }
}

const mergeOptions = {
  directMerge: true,
  deduplicateNodes: true,
  deduplicateWays: true,
};

describe("worker hard match blockers", () => {
  it("keeps grade conflicts blocked in pages and skips them in filtered bulk acceptance", () => {
    const worker = new TestWorker();
    const { base, patch } = createBlockedBridgeFixture();
    worker.setOsm(base);
    worker.setOsm(patch);

    const summary = worker.discoverConflation(base.id, patch.id, {
      propertyKeys: ["name"],
      attachNetwork: false,
    });
    expect(summary).toMatchObject({ total: 1, blocked: 1, review: 0 });
    worker.setConflationFilter(base.id, { entityType: "way", status: "blocked" });
    const page = worker.getConflationPage(base.id, 0, 1);
    expect(page.totalCandidates).toBe(1);
    expect(page.candidates[0]).toMatchObject({
      id: "way:20->10",
      status: "blocked",
      propertyTransfer: { status: "blocked" },
    });
    expect(page.candidates[0]?.reasons).toEqual(
      expect.arrayContaining(["grade-conflict", "relation-member"]),
    );
    expect(page.bulkActions["transfer-properties"]).toMatchObject({
      filteredCandidates: 1,
      eligibleCandidates: 0,
      skippedCandidates: 1,
      changedCandidates: 0,
    });

    const bulk = worker.applyConflationBulkDecision(base.id, {
      action: "transfer-properties",
      filter: { entityType: "way" },
    });
    expect(bulk.preview).toMatchObject({
      filteredCandidates: 1,
      eligibleCandidates: 0,
      skippedCandidates: 1,
      changedCandidates: 0,
    });
    expect(bulk.decisions).toEqual([]);
    expect(bulk.summary).toMatchObject({ blocked: 1, accepted: 0 });
  });

  it("does not apply a blocked transfer or report it as accepted after an explicit decision", async () => {
    const worker = new TestWorker();
    const { base, patch } = createBlockedBridgeFixture();
    const baseline = await merge(base, patch, mergeOptions, () => {});
    worker.setOsm(base);
    worker.setOsm(patch);
    worker.discoverConflation(base.id, patch.id, {
      propertyKeys: ["name"],
      attachNetwork: false,
    });

    const summary = worker.setConflationDecision(base.id, {
      candidateId: "way:20->10",
      action: "accept",
      transferProperties: true,
      attachNetwork: false,
    });
    worker.generateConflationChangeset(base.id, mergeOptions);
    expect(summary).toMatchObject({ blocked: 1, accepted: 0 });
    worker.setConflationFilter(base.id, { status: "blocked" });
    expect(worker.getConflationPage(base.id, 0, 1).totalCandidates).toBe(1);
    worker.setConflationFilter(base.id, { status: "accepted" });
    expect(worker.getConflationPage(base.id, 0, 1).totalCandidates).toBe(0);

    worker.applyChangesAndReplace(base.id);
    expect(entitySnapshot(worker.getOsm(base.id))).toEqual(entitySnapshot(baseline));
  });
});
