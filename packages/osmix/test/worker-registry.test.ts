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
});
