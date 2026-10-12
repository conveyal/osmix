import { describe, expect, it } from "vitest";

import { Osm } from "../src/index.ts";
import { OsmixWorker } from "../src/worker.ts";

/** Exposes the worker's dataset registry so the test can read the applied result. */
class TestWorker extends OsmixWorker {
  dataset(osmId: string) {
    return this.get(osmId);
  }
}

/** Two ways whose nodes and refs duplicate each other, plus a relation that references both. */
function createDuplicatedFixture(id: string) {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
  osm.nodes.addNode({ id: 2, lon: 0.001, lat: 0 });
  osm.nodes.addNode({ id: 11, lon: 0, lat: 0 });
  osm.nodes.addNode({ id: 12, lon: 0.001, lat: 0 });
  osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "residential" } });
  osm.ways.addWay({ id: 20, refs: [11, 12], tags: { highway: "residential" } });
  osm.relations.addRelation({
    id: 100,
    tags: { type: "route" },
    members: [
      { type: "way", ref: 10, role: "" },
      { type: "way", ref: 20, role: "" },
      { type: "node", ref: 1, role: "stop" },
    ],
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

/** Assert every way ref and relation member resolves to an entity in the dataset. */
function expectReferencesResolve(osm: Osm) {
  for (const way of osm.ways.sorted()) {
    for (const ref of way.refs)
      expect(osm.nodes.getById(ref), `way ${way.id} ref ${ref}`).toBeTruthy();
  }
  for (const relation of osm.relations.sorted()) {
    for (const member of relation.members) {
      const entity =
        member.type === "node"
          ? osm.nodes.getById(member.ref)
          : member.type === "way"
            ? osm.ways.getById(member.ref)
            : osm.relations.getById(member.ref);
      expect(entity, `relation ${relation.id} member ${member.type}/${member.ref}`).toBeTruthy();
    }
  }
}

async function scan(worker: TestWorker, osmId: string) {
  return worker.planDeduplication(osmId);
}

describe("within-dataset deduplication", () => {
  it("applies duplicate candidates so a re-scan finds none and references still resolve", async () => {
    const worker = new TestWorker();
    const osm = createDuplicatedFixture("within-dataset");
    worker.transferIn(osm.transferables());

    const stats = await scan(worker, osm.id);
    expect(stats.deduplicatedNodes).toBe(2);
    expect(stats.deduplicatedWays).toBe(1);

    worker.applyChangesAndReplace(osm.id);
    const applied = worker.dataset(osm.id);
    expect(applied.nodes.size).toBe(2);
    expect(applied.ways.size).toBe(1);
    // The highest compatible ID survives.
    expect(applied.nodes.getById(11)).toBeTruthy();
    expect(applied.nodes.getById(12)).toBeTruthy();
    expect(applied.ways.getById(20)?.refs).toEqual([11, 12]);
    expectReferencesResolve(applied);

    expect((await scan(worker, osm.id)).totalChanges).toBe(0);
  });
});
