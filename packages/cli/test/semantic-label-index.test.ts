import { Osm } from "osmix";
import { describe, expect, it, vi } from "vitest";

import { SemanticLabelIndex } from "../src/semantic-label-index.ts";
import { CliTileWorker } from "../src/tile-worker.ts";

function addWay(osm: Osm, id: number, refs: number[], tags: Record<string, string>): void {
  osm.ways.addWay({ id, refs, tags });
}

function semanticLabelOsm(id: string): Osm {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: 1, lon: -0.1, lat: -0.05 });
  osm.nodes.addNode({ id: 2, lon: 0.1, lat: -0.05 });
  osm.nodes.addNode({ id: 3, lon: 0.1, lat: 0.05 });
  osm.nodes.addNode({ id: 4, lon: -0.1, lat: 0.05 });
  addWay(osm, 10, [1, 2], { highway: "primary", name: "Primary Road" });
  addWay(osm, 11, [3, 4], { highway: "residential", name: "Residential Road" });
  addWay(osm, 12, [1, 2, 3, 4, 1], { building: "yes", name: "Named Building" });
  addWay(osm, 13, [1, 2, 3, 4, 1], { natural: "water", name: "Relation Lake" });
  osm.relations.addRelation({
    id: 20,
    members: [{ type: "way", ref: 13, role: "outer" }],
    tags: { type: "multipolygon", natural: "water", name: "Relation Lake" },
  });
  osm.buildIndexes();
  osm.ways.buildSpatialIndex();
  osm.relations.buildSpatialIndex();
  return osm;
}

class ExposedCliTileWorker extends CliTileWorker {
  getOsm(id: string): Osm {
    return this.get(id);
  }
}

describe("SemanticLabelIndex", () => {
  it("prefilters named entities by classification, bbox, and minimum zoom", () => {
    const index = SemanticLabelIndex.build(semanticLabelOsm("label-index"));

    expect(index.wayCount).toBe(3);
    expect(index.relationCount).toBe(1);
    expect(index.providers(8).ways.intersects([-1, -1, 1, 1])).toEqual([3]);
    expect(index.providers(9).ways.intersects([-1, -1, 1, 1])).toEqual([0, 3]);
    expect(index.providers(12).ways.intersects([-1, -1, 1, 1])).toEqual([0, 1, 3]);
    expect(index.providers(12).ways.intersects([10, 10, 11, 11])).toEqual([]);
    expect(index.providers(8).relations.intersects([-1, -1, 1, 1])).toEqual([0]);
  });

  it("keeps worker label queries off the raw way and relation spatial indexes", () => {
    const osm = semanticLabelOsm("worker-semantic-labels");
    const worker = new ExposedCliTileWorker();
    worker.transferIn(osm.transferables());
    const workerOsm = worker.getOsm(osm.id);
    const waySearch = vi.spyOn(workerOsm.ways, "intersects");
    const relationSearch = vi.spyOn(workerOsm.relations, "intersects");

    const result = worker.getMapLabelCandidates(osm.id, {
      centerX: 0.5,
      centerY: 0.5,
      revision: 23,
      viewport: { width: 200, height: 100 },
      zoom: 9,
    });

    expect(result.revision).toBe(23);
    expect(result.candidates.some((candidate) => candidate.text === "Primary Road")).toBe(true);
    expect(result.candidates.some((candidate) => candidate.text === "Named Building")).toBe(false);
    expect(waySearch).not.toHaveBeenCalled();
    expect(relationSearch).not.toHaveBeenCalled();
    worker.delete(osm.id);
  });

  it("retains preclassification when the same shared dataset is transferred again", () => {
    const osm = semanticLabelOsm("shared-semantic-labels");
    const worker = new ExposedCliTileWorker();
    worker.transferIn(osm.transferables());
    worker.buildSemanticLabelIndex(osm.id);
    const build = vi.spyOn(SemanticLabelIndex, "build");

    worker.transferIn(osm.transferables());
    worker.getMapLabelCandidates(osm.id, {
      centerX: 0.5,
      centerY: 0.5,
      revision: 24,
      viewport: { width: 200, height: 100 },
      zoom: 9,
    });

    expect(build).not.toHaveBeenCalled();
    worker.delete(osm.id);
  });
});
