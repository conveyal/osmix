import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { OsmixWorker } from "../src/worker.ts";

class TestWorker extends OsmixWorker {
  add(osm: Osm) {
    this.set(osm.id, osm);
  }
}

function dataset(id: string, build: (osm: Osm) => void) {
  const osm = new Osm({ id });
  build(osm);
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("plan integrity issues in review", () => {
  it("names the imported feature each issue concerns, for the review to open it", () => {
    const base = dataset("base", (osm) => {
      osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
      osm.nodes.addNode({ id: 2, lon: 0.001, lat: 0 });
      osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "residential" } });
    });
    // The imported footway references a node neither dataset has.
    const patch = dataset("patch", (osm) => {
      osm.nodes.addNode({ id: -1, lon: 0, lat: 0.001 });
      osm.ways.addWay({ id: -1, refs: [-1, -99], tags: { highway: "footway" } });
    });
    const worker = new TestWorker();
    worker.add(base);
    worker.add(patch);
    const overview = worker.planMerge(base.id, patch.id, {});
    expect(overview.diagnostics.integrity).toEqual([
      {
        description: "way -1 references missing node -99",
        entities: [{ type: "way", id: -1 }],
        featureKey: "way:-1",
      },
    ]);
  });
});
