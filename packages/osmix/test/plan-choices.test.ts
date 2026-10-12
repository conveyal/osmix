import { describe, expect, it } from "vitest";

import { Osm } from "../src/index.ts";
import { OsmixWorker } from "../src/worker.ts";

const M = 1 / 111_320;

class TestWorker extends OsmixWorker {
  add(osm: Osm) {
    this.set(osm.id, osm);
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

/**
 * A base footway ending at node 1; an imported footway that starts 0.7 m east of it, loops
 * away and ends 0.1 m north of it (two points of one way competing for node 1, MP-M5); and an
 * imported kerb
 * near base node 3. Conservative automation leaves the clear choice to a person.
 */
function planned() {
  const base = osm(
    "choices-base",
    [
      { id: 1, lon: 0, lat: 0 },
      { id: 2, lon: 0, lat: -0.001 },
      { id: 3, lon: 0.01, lat: 0 },
    ],
    [{ id: 10, refs: [2, 1], tags: { highway: "footway" } }],
  );
  const patch = osm(
    "choices-patch",
    [
      { id: 201, lon: 0.7 * M, lat: 0 },
      { id: 101, lon: 0, lat: 0.1 * M },
      { id: 102, lon: 0.001, lat: 0.001 },
      { id: 301, lon: 0.01 + 0.2 * M, lat: 0, tags: { kerb: "lowered" } },
    ],
    [{ id: 20, refs: [201, 102, 101], tags: { highway: "footway" } }],
  );
  const worker = new TestWorker();
  worker.add(base);
  worker.add(patch);
  const overview = worker.planMerge(base.id, patch.id, {
    automation: "conservative",
    matching: { propertyKeys: ["kerb"], attachNetwork: true, maxDistanceMeters: 1 },
  });
  return { worker, baseId: base.id, overview };
}

describe("choice groups in the worker (MP-M7)", () => {
  it("counts features that need a decision by why they wait", () => {
    const { overview } = planned();
    expect(overview.choices).toMatchObject({ nearest: 1, "routing-tags": 1 });
    const total = Object.values(overview.choices).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(overview.summary.features["needs-decision"]);
  });

  it("pages, previews and decides one group at a time", () => {
    const { worker, baseId } = planned();
    const page = worker.getMergePlanPage(baseId, 0, 10);
    expect(page.total).toBe(2);
    worker.setMergePlanFilter(baseId, { group: "nearest" });
    expect(worker.getMergePlanPage(baseId, 0, 10).features.map(({ key }) => key)).toEqual([
      "way:20",
    ]);
    const preview = worker.previewMergePlanBulk(baseId);
    // Counts are in features: both points are on way 20.
    expect(preview["pick-nearest"]).toEqual({ changed: 1, waiting: 0 });

    const picked = worker.applyMergePlanBulk(baseId, {
      action: "pick-nearest",
      filter: { group: "nearest" },
    });
    expect(picked.changed).toBe(1);
    // The farther point is left out too, so only the kerb copy still waits.
    expect(picked.overview.decisions).toEqual([
      { proposalId: "connect:n101>n1", action: "accept" },
      { proposalId: "connect:n201>n1", action: "reject" },
    ]);
    expect(picked.overview.choices).toMatchObject({ nearest: 0, "routing-tags": 1 });

    const copied = worker.applyMergePlanBulk(baseId, {
      action: "accept",
      filter: { group: "routing-tags" },
    });
    expect(copied.overview.summary.features["needs-decision"]).toBe(0);
  });
});
