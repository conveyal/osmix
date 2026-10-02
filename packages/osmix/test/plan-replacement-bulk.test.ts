import { describe, expect, it } from "vitest";

import { Osm, OsmixWorker, type OsmNode, type OsmWay } from "../src/index";

/** Degrees per meter at the equator. */
const M = 1 / 111_320;
const footway = { highway: "footway" };

class TestWorker extends OsmixWorker {
  add(osm: Osm) {
    this.set(osm.id, osm);
  }
}

function osm(id: string, nodes: OsmNode[], ways: OsmWay[]) {
  const result = new Osm({ id });
  for (const node of nodes) result.nodes.addNode(node);
  for (const way of ways) result.ways.addWay(way);
  result.buildIndexes();
  result.buildSpatialIndexes();
  return result;
}

/** A base footway with an untagged middle node, and an imported sidewalk 0.5 m north of it. */
function inputs() {
  const base = osm(
    "base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0.0005, lat: 0 },
      { id: 3, lon: 0.001, lat: 0 },
    ],
    [{ id: 10, refs: [1, 2, 3], tags: footway }],
  );
  const patch = osm(
    "patch",
    [0, 0.0005, 0.001].map((lon, index) => ({ id: 101 + index, lon, lat: 0.5 * M })),
    [{ id: 20, refs: [101, 102, 103], tags: { ...footway, footway: "sidewalk" } }],
  );
  return { base, patch };
}

function workerFor() {
  const { base, patch } = inputs();
  const worker = new TestWorker();
  worker.add(base);
  worker.add(patch);
  worker.planMerge(base.id, patch.id, {
    automation: "conservative",
    matching: {
      propertyKeys: [],
      attachNetwork: true,
      maxDistanceMeters: 1,
      allowWayReplacement: true,
    },
  });
  return { worker, baseId: base.id };
}

const included = (decisions: readonly { proposalId: string; action: string }[]) =>
  decisions.filter(({ action }) => action === "accept").map(({ proposalId }) => proposalId);

describe("bulk choices and way replacement (MP-R2)", () => {
  it("includes a replacement in bulk, which leaves out the connections it excludes", () => {
    const { worker, baseId } = workerFor();
    const result = worker.applyMergePlanBulk(baseId, {
      action: "accept",
      filter: { group: "replacement" },
    });
    expect(included(result.overview.decisions)).toEqual(["replace:w20>w10"]);
    expect(result.waiting).toBe(0);
  });

  it("leaves connections a replacement excludes for their own choice", () => {
    const { worker, baseId } = workerFor();
    const result = worker.applyMergePlanBulk(baseId, { action: "accept", filter: {} });
    // Every connection excludes the replacement, so only the replacement is includable.
    expect(included(result.overview.decisions)).toEqual(["replace:w20>w10"]);
  });

  it("skips a replacement in bulk once a connection it excludes is included", () => {
    const { worker, baseId } = workerFor();
    worker.setMergePlanDecisions(baseId, [{ proposalId: "connect:n101>n1", action: "accept" }]);
    const result = worker.applyMergePlanBulk(baseId, {
      action: "accept",
      filter: { group: "replacement" },
    });
    expect(included(result.overview.decisions)).toEqual(["connect:n101>n1"]);
  });

  it("never decides one member of a set against another", () => {
    const { base } = inputs();
    const split = osm(
      "patch",
      [0, 0.0005, 0.001].map((lon, index) => ({ id: 101 + index, lon, lat: 0.5 * M })),
      [
        { id: 20, refs: [101, 102], tags: { ...footway, surface: "asphalt" } },
        { id: 30, refs: [102, 103], tags: { ...footway, surface: "concrete" } },
      ],
    );
    const worker = new TestWorker();
    worker.add(base);
    worker.add(split);
    worker.planMerge(base.id, split.id, {
      automation: "conservative",
      matching: {
        propertyKeys: [],
        attachNetwork: true,
        maxDistanceMeters: 1,
        allowWayReplacement: true,
      },
    });
    worker.setMergePlanDecisions(base.id, [{ proposalId: "replace:w20>w10", action: "accept" }]);
    const result = worker.applyMergePlanBulk(base.id, { action: "reject", filter: {} });
    const replacements = result.overview.decisions.filter(({ proposalId }) =>
      proposalId.startsWith("replace:"),
    );
    expect(replacements).toEqual([{ proposalId: "replace:w20>w10", action: "accept" }]);
  });
});
