import { describe, expect, it } from "vitest";

import { merge, Osm, type MergePlanOptions } from "../src/index";
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

const ordinaryOptions: MergePlanOptions = { createIntersections: false };
const planOptions: MergePlanOptions = {
  ...ordinaryOptions,
  matching: { propertyKeys: ["name"], attachNetwork: false },
};
const copyId = "copy:w20>w10";

function planned() {
  const worker = new TestWorker();
  const { base, patch } = createBlockedBridgeFixture();
  worker.setOsm(base);
  worker.setOsm(patch);
  const overview = worker.planMerge(base.id, patch.id, planOptions);
  return { worker, base, patch, overview };
}

describe("worker hard match blockers", () => {
  it("keeps grade conflicts blocked in pages and skips them in filtered bulk acceptance", () => {
    const { worker, base, overview } = planned();
    expect(overview.matching?.candidates).toMatchObject({ total: 1, blocked: 1, review: 0 });
    expect(overview.summary.proposals.blocked).toBeGreaterThanOrEqual(1);
    worker.setMergePlanFilter(base.id, { kind: "copy-tags", status: "blocked" });
    const page = worker.getMergePlanPage(base.id, 0, 1);
    expect(page.total).toBe(1);
    const proposal = page.features[0]?.proposals.find(({ id }) => id === copyId);
    expect(proposal).toMatchObject({
      kind: "copy-tags",
      candidateId: "way:20->10",
      status: "blocked",
      effect: "blocked",
    });
    expect(proposal?.reasons).toEqual(
      expect.arrayContaining(["grade-conflict", "relation-member"]),
    );

    const bulk = worker.applyMergePlanBulk(base.id, {
      action: "accept",
      filter: { kind: "copy-tags" },
    });
    expect(bulk).toMatchObject({ changed: 0, skipped: 0 });
    expect(bulk.overview.decisions).toEqual([]);
    expect(bulk.overview.summary.proposals.blocked).toBe(overview.summary.proposals.blocked);
  });

  it("does not apply a blocked transfer or report it as applied after an explicit decision", async () => {
    const { base, patch } = createBlockedBridgeFixture();
    const baseline = await merge(base, patch, ordinaryOptions, () => {});
    const { worker } = planned();

    const decided = worker.setMergePlanDecisions(base.id, [
      { proposalId: copyId, action: "accept" },
    ]);
    expect(decided.decisions).toEqual([{ proposalId: copyId, action: "accept" }]);
    expect(decided.matching?.outcome.summary).toMatchObject({ tagCopyActions: 0 });
    worker.setMergePlanFilter(base.id, { status: "blocked" });
    const blocked = worker.getMergePlanPage(base.id, 0, 1);
    expect(blocked.total).toBe(1);
    expect(blocked.features[0]?.proposals.find(({ id }) => id === copyId)).toMatchObject({
      decision: "accept",
      effect: "blocked",
    });

    worker.applyMergePlan(base.id);
    expect(entitySnapshot(worker.getOsm(base.id))).toEqual(entitySnapshot(baseline));
  });
});
