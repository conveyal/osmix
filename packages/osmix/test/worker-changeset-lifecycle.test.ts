import { describe, expect, it } from "vitest";

import { merge, Osm, type OsmConflationDecision } from "../src/index.ts";
import { OsmixWorker } from "../src/worker.ts";

const discoveryOptions = { propertyKeys: ["name"], attachNetwork: false };
const accepted: OsmConflationDecision = {
  candidateId: "way:20->10",
  action: "accept",
  transferProperties: true,
  attachNetwork: false,
};

function createFootway(id: string, firstNodeId: number, wayId: number, lat: number, name: string) {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: firstNodeId, lon: 0, lat });
  osm.nodes.addNode({ id: firstNodeId + 1, lon: 0.001, lat });
  osm.nodes.addNode({ id: 3, lon: 0.05, lat: 0.05, tags: { name: `${name} point` } });
  osm.ways.addWay({
    id: wayId,
    refs: [firstNodeId, firstNodeId + 1],
    tags: { highway: "footway", name },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

function createFixture(prefix = "lifecycle") {
  const base = createFootway(`${prefix}-base`, 1, 10, 0, "Base path");
  const patch = createFootway(`${prefix}-patch`, 101, 20, 0.000004, "Imported path");
  const worker = new OsmixWorker();
  worker.transferIn(base.transferables());
  worker.transferIn(patch.transferables());
  worker.discoverConflation(base.id, patch.id, discoveryOptions);
  worker.setConflationDecision(base.id, accepted);
  return { worker, base, patch };
}

function entities(osm: Osm) {
  return {
    nodes: [...osm.nodes.sorted()],
    ways: [...osm.ways.sorted()],
    relations: [...osm.relations.sorted()],
  };
}

function preview(worker: OsmixWorker, baseId: string) {
  return structuredClone(worker.getChangesetPage(baseId, 0, 100));
}

describe("worker changeset lifecycle", () => {
  it.each(["edit", "replace decisions", "bulk", "clear", "rediscover"] as const)(
    "preserves the latest ordinary preview when candidate review changes (%s)",
    async (action) => {
      const { worker, base, patch } = createFixture();
      worker.generateConflationChangeset(base.id, { directMerge: true });
      const conflationPreview = preview(worker, base.id);
      await worker.generateChangeset(base.id, patch.id, { directMerge: true });
      const ordinaryPreview = preview(worker, base.id);
      expect(ordinaryPreview).not.toEqual(conflationPreview);
      expect(worker.getConflationPage(base.id, 0, 100).candidates[0]?.decision).toEqual(accepted);

      worker.setChangesetFilters(["create"], ["way"]);
      const filteredPreview = preview(worker, base.id);
      expect(filteredPreview.changes?.map((change) => change.entity.id)).toEqual([20]);
      if (action === "edit") {
        worker.setConflationDecision(base.id, {
          candidateId: accepted.candidateId,
          action: "reject",
        });
      } else if (action === "replace decisions") {
        worker.setConflationDecisions(base.id, []);
      } else if (action === "bulk") {
        worker.applyConflationBulkDecision(base.id, {
          action: "reject",
          filter: { entityType: "way" },
        });
      } else if (action === "clear") {
        worker.clearConflation(base.id);
      } else {
        worker.discoverConflation(base.id, patch.id, discoveryOptions);
      }

      expect(preview(worker, base.id)).toEqual(filteredPreview);
      worker.setChangesetFilters(["create", "modify", "delete"], ["node", "way", "relation"]);
      expect(preview(worker, base.id)).toEqual(ordinaryPreview);
      worker.applyChangesAndReplace(base.id);
      const expected = await merge(base, patch, { directMerge: true }, () => {});
      expect(entities(new Osm(worker.getOsmBuffers(base.id)))).toEqual(entities(expected));
    },
  );

  it("invalidates a current conflation preview when its decisions change", async () => {
    const { worker, base, patch } = createFixture();
    await worker.generateChangeset(base.id, patch.id, { directMerge: true });
    worker.generateConflationChangeset(base.id, { directMerge: true });
    expect(preview(worker, base.id).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeType: "modify",
          entity: expect.objectContaining({
            id: 10,
            tags: { highway: "footway", name: "Imported path" },
          }),
        }),
      ]),
    );
    worker.setConflationDecision(base.id, { candidateId: accepted.candidateId, action: "reject" });
    expect(() => preview(worker, base.id)).toThrow("No active changeset");
    worker.generateConflationChangeset(base.id, { directMerge: true });
    worker.applyChangesAndReplace(base.id);
    const expected = await merge(base, patch, { directMerge: true }, () => {});
    expect(entities(new Osm(worker.getOsmBuffers(base.id)))).toEqual(entities(expected));
  });

  it.each([
    ["base", "replace"],
    ["base", "delete"],
    ["base", "rename"],
    ["patch", "replace"],
    ["patch", "delete"],
    ["patch", "rename"],
  ] as const)(
    "invalidates dependent review and ordinary output after %s %s",
    async (side, operation) => {
      const { worker, base, patch } = createFixture();
      await worker.generateChangeset(base.id, patch.id, { directMerge: true });
      expect(preview(worker, base.id).changes?.length).toBeGreaterThan(0);
      const input = side === "base" ? base : patch;
      if (operation === "replace") {
        const replacement = createFootway(input.id, 201, 30, 0.01, "Replacement");
        worker.transferIn(replacement.transferables());
      } else {
        const buffers = worker.getOsmBuffers(input.id);
        worker.delete(input.id);
        if (operation === "rename") {
          // OsmixRemote renames datasets with these same worker operations.
          worker.transferIn({ ...buffers, id: `${input.id}-renamed` });
        }
      }
      expect(() => worker.getConflationPage(base.id, 0, 100)).toThrow(
        "No active conflation session",
      );
      expect(() => preview(worker, base.id)).toThrow("No active changeset");
      expect(() => worker.applyChangesAndReplace(base.id)).toThrow("No active changeset");
    },
  );

  it("does not discard an ordinary preview that uses a different patch from the obsolete review", async () => {
    const { worker, base, patch } = createFixture();
    worker.generateConflationChangeset(base.id, { directMerge: true });
    const latestPatch = createFootway("latest-patch", 201, 30, 0.01, "Latest patch");
    worker.transferIn(latestPatch.transferables());
    await worker.generateChangeset(base.id, latestPatch.id, { directMerge: true });
    const latestPreview = preview(worker, base.id);

    worker.delete(patch.id);

    expect(() => worker.getConflationSummary(base.id)).toThrow("No active conflation session");
    expect(preview(worker, base.id)).toEqual(latestPreview);
    worker.applyChangesAndReplace(base.id);
    const expected = await merge(base, latestPatch, { directMerge: true }, () => {});
    expect(entities(new Osm(worker.getOsmBuffers(base.id)))).toEqual(entities(expected));
  });

  it("invalidates only generations that depend on the replaced dataset", async () => {
    const { worker, base, patch } = createFixture("first");
    const otherBase = createFootway("second-base", 1, 10, 0, "Other base");
    const otherPatch = createFootway("second-patch", 101, 20, 0.000004, "Other patch");
    worker.transferIn(otherBase.transferables());
    worker.transferIn(otherPatch.transferables());
    await worker.generateChangeset(base.id, patch.id, { directMerge: true });
    await worker.generateChangeset(otherBase.id, otherPatch.id, { directMerge: true });
    const otherPreview = preview(worker, otherBase.id);

    worker.delete(patch.id);

    expect(() => preview(worker, base.id)).toThrow("No active changeset");
    expect(preview(worker, otherBase.id)).toEqual(otherPreview);
    worker.applyChangesAndReplace(otherBase.id);
    const expected = await merge(otherBase, otherPatch, { directMerge: true }, () => {});
    expect(entities(new Osm(worker.getOsmBuffers(otherBase.id)))).toEqual(entities(expected));
  });
});
