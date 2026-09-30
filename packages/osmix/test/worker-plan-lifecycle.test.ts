import { pointToTile } from "@mapbox/tilebelt";
import { VectorTile } from "@mapbox/vector-tile";
import type { Tile } from "@osmix/types";
import { PbfReader } from "pbf";
import { describe, expect, it } from "vitest";

import { Osm, PLAN_TILE_LAYERS, type MergePlanOptions } from "../src/index.ts";
import { OsmixWorker } from "../src/worker.ts";

class TestWorker extends OsmixWorker {
  setOsm(osm: Osm) {
    this.set(osm.id, osm);
  }

  getOsm(id: string) {
    return this.get(id);
  }
}

function osm(
  id: string,
  nodes: Parameters<Osm["nodes"]["addNode"]>[0][],
  ways: Parameters<Osm["ways"]["addWay"]>[0][],
) {
  const result = new Osm({ id });
  for (const node of nodes) result.nodes.addNode(node);
  for (const way of ways) result.ways.addWay(way);
  result.buildIndexes();
  result.buildSpatialIndexes();
  return result;
}

/** Each plan tile layer's feature properties, in tile order. */
function planTileFeatures(data: ArrayBuffer) {
  const tile = new VectorTile(new PbfReader(new Uint8Array(data)));
  const properties = (name: string) => {
    const layer = tile.layers[name];
    if (!layer) return [];
    return Array.from({ length: layer.length }, (_, i) => layer.feature(i).properties);
  };
  return { ways: properties(PLAN_TILE_LAYERS.ways), nodes: properties(PLAN_TILE_LAYERS.nodes) };
}

/**
 * A base sidewalk; an imported copy about 0.45 m north with a branch off its far end; and an
 * imported bench at a base bench's exact position.
 */
function inputs() {
  const base = osm(
    "base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0.001, lat: 0 },
      { id: 3, lon: 0.01, lat: 0.01, tags: { amenity: "bench" } },
    ],
    [{ id: 10, refs: [1, 2], tags: { highway: "footway" } }],
  );
  const patch = osm(
    "patch",
    [
      { id: -1, lon: 0, lat: 0.000004 },
      { id: -2, lon: 0.001, lat: 0.000004 },
      { id: -3, lon: 0.002, lat: 0.000004 },
      { id: -4, lon: 0.01, lat: 0.01, tags: { amenity: "bench", backrest: "yes" } },
    ],
    [
      { id: -1, refs: [-1, -2], tags: { highway: "footway", name: "Harbour Walk" } },
      { id: -2, refs: [-2, -3], tags: { highway: "footway" } },
    ],
  );
  return { base, patch };
}

const options: MergePlanOptions = {
  matching: {
    propertyKeys: ["name"],
    attachNetwork: true,
    allowWayRemoval: true,
    automatic: "none",
  },
};

function planned() {
  const worker = new TestWorker();
  const { base, patch } = inputs();
  worker.setOsm(base);
  worker.setOsm(patch);
  const overview = worker.planMerge(base.id, patch.id, options);
  return { worker, base, patch, overview };
}

describe("worker merge plan sessions", () => {
  it("summarizes a plan and pages its features, decisions first", () => {
    const { worker, base, patch, overview } = planned();
    expect(overview).toMatchObject({
      inputs: { base: { id: base.id }, patch: { id: patch.id } },
      featureCount: 3,
      decisions: [],
    });
    expect(overview.summary.features["needs-decision"]).toBe(1);
    const page = worker.getMergePlanPage(base.id, 0, 10);
    expect(page.total).toBe(3);
    expect(page.features.map(({ key, outcome }) => [key, outcome])).toEqual([
      ["way:-1", "needs-decision"],
      ["node:-4", "merged"],
      ["way:-2", "added"],
    ]);
    expect(page.features[0]).toMatchObject({ name: "Harbour Walk" });
    expect(page.features[0]?.proposals.map(({ id }) => id)).toContain("connect:n-1>n1");

    worker.setMergePlanFilter(base.id, { kind: "exact-merge" });
    expect(worker.getMergePlanPage(base.id, 0, 10).features.map(({ key }) => key)).toEqual([
      "node:-4",
    ]);
    expect(worker.getMergePlanPage(base.id, 0, 10).totalPages).toBe(1);
  });

  it("shows one feature's evidence and target geometry", () => {
    const { worker, base } = planned();
    const detail = worker.getMergePlanFeature(base.id, "way:-1");
    expect(detail.coordinates).toEqual([
      [0, 0.000004],
      [0.001, 0.000004],
    ]);
    expect(detail.candidates["connect:n-1>n1"]?.evidence.distanceMeters).toBeCloseTo(0.45, 1);
    expect(detail.targets["connect:n-1>n1"]).toEqual([[0, 0]]);
    expect(() => worker.getMergePlanFeature(base.id, "way:99")).toThrow(
      "No feature way:99 in this merge plan",
    );
  });

  it("draws the imported features as tiles coloured by their current outcome", () => {
    const { worker, base } = planned();
    const covering = pointToTile(0.005, 0.005, 10) as Tile;
    expect(planTileFeatures(worker.getMergePlanTile(base.id, covering))).toEqual({
      ways: [
        { featureKey: "way:-1", outcome: "needs-decision" },
        { featureKey: "way:-2", outcome: "added" },
      ],
      nodes: [{ featureKey: "node:-4", outcome: "merged" }],
    });
    expect(worker.getMergePlanTile(base.id, pointToTile(90, 45, 10) as Tile).byteLength).toBe(0);

    worker.setMergePlanDecisions(base.id, [{ proposalId: "exact:n-4>n3", action: "reject" }]);
    const decided = worker.getMergePlanFeature(base.id, "node:-4").outcome;
    expect(decided).not.toBe("merged");
    expect(planTileFeatures(worker.getMergePlanTile(base.id, covering)).nodes).toEqual([
      { featureKey: "node:-4", outcome: decided },
    ]);

    worker.clearMergePlan(base.id);
    expect(worker.getMergePlanTile(base.id, covering).byteLength).toBe(0);
  });

  it("replans with decisions and applies them in bulk", () => {
    const { worker, base } = planned();
    const decided = worker.setMergePlanDecisions(base.id, [
      { proposalId: "connect:n-1>n1", action: "accept" },
    ]);
    expect(decided.decisions).toEqual([{ proposalId: "connect:n-1>n1", action: "accept" }]);

    const accepted = worker.applyMergePlanBulk(base.id, {
      action: "accept",
      filter: { kind: "connect" },
    });
    expect(accepted.changed).toBe(1);
    expect(accepted.overview.decisions).toContainEqual({
      proposalId: "connect:n-2>n2",
      action: "accept",
    });

    const cleared = worker.applyMergePlanBulk(base.id, { action: "clear", filter: {} });
    expect(cleared.changed).toBe(2);
    expect(cleared.overview.decisions).toEqual([]);

    const rejected = worker.applyMergePlanBulk(base.id, {
      action: "reject",
      filter: { outcome: "merged" },
    });
    expect(rejected.overview.decisions).toEqual([{ proposalId: "exact:n-4>n3", action: "reject" }]);
  });

  it("writes the plan as osmChange", () => {
    const { worker, base } = planned();
    expect(worker.getMergePlanOsc(base.id)).toMatch(/<create>.*<way id="-1"/s);
  });

  it("applies the plan in place of the base and removes the patch", () => {
    const { worker, base, patch } = planned();
    worker.setMergePlanDecisions(base.id, [{ proposalId: "connect:n-2>n2", action: "accept" }]);
    const result = worker.applyMergePlan(base.id);
    expect(result.osmId).toBe(base.id);
    expect(worker.has(patch.id)).toBe(false);
    const merged = worker.getOsm(base.id);
    expect(merged.ways.getById(-2)?.refs).toEqual([2, -3]);
    expect(merged.nodes.getById(3)?.tags).toEqual({ amenity: "bench", backrest: "yes" });
    expect(() => worker.getMergePlanOverview(base.id)).toThrow("No active merge plan");
  });

  it("forgets a plan when either input changes or the plan is cleared", () => {
    const first = planned();
    first.worker.delete(first.patch.id);
    expect(() => first.worker.getMergePlanOverview(first.base.id)).toThrow("No active merge plan");

    const second = planned();
    second.worker.clearMergePlan(second.base.id);
    expect(() => second.worker.getMergePlanPage(second.base.id, 0, 10)).toThrow(
      "No active merge plan",
    );
  });

  it("finds duplicates inside one dataset for the changeset page API", () => {
    const worker = new TestWorker();
    const dataset = osm(
      "duplicates",
      [
        { id: 1, lon: 0, lat: 0 },
        { id: 2, lon: 0, lat: 0 },
        { id: 3, lon: 0.001, lat: 0 },
      ],
      [
        { id: 10, refs: [1, 3], tags: { highway: "footway" } },
        { id: 11, refs: [2, 3], tags: { highway: "footway" } },
      ],
    );
    worker.setOsm(dataset);
    const stats = worker.planDeduplication(dataset.id);
    expect(stats).toMatchObject({ deduplicatedNodes: 1, deduplicatedWays: 1 });
    const page = worker.getChangesetPage(dataset.id, 0, 10);
    expect(page.changes?.length).toBeGreaterThan(0);
    expect(page.total).toBe(stats.totalChanges);
    worker.setChangesetFilters(["delete"], ["node", "way", "relation"]);
    expect(worker.getChangesetPage(dataset.id, 0, 10).total).toBe(stats.deleteChanges);
    worker.setChangesetFilters(["create", "modify", "delete"], ["node", "way", "relation"]);
    worker.applyChangesAndReplace(dataset.id);
    expect(worker.getOsm(dataset.id).ways.size).toBe(1);
  });
});
