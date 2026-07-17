import { Osm } from "osmix";
import { describe, expect, it, vi } from "vitest";

import { SemanticNodeIndex } from "../src/semantic-node-index.ts";
import { CliTileWorker } from "../src/tile-worker.ts";

function semanticNodeOsm(id: string): Osm {
  const osm = new Osm({ id });
  osm.nodes.addNode({ id: 1, lon: 0, lat: 0, tags: { place: "city", name: "Center City" } });
  osm.nodes.addNode({ id: 2, lon: 0.1, lat: 0, tags: { amenity: "cafe", name: "Cafe" } });
  osm.nodes.addNode({ id: 3, lon: 0.2, lat: 0, tags: { amenity: "hospital" } });
  osm.nodes.addNode({ id: 4, lon: 0.3, lat: 0, tags: { name: "Unclassified" } });
  for (let node = 5; node < 1_005; node++) {
    osm.nodes.addNode({ id: node, lon: 10 + node / 10_000, lat: 10 });
  }
  osm.buildIndexes();
  osm.ways.buildSpatialIndex();
  osm.relations.buildSpatialIndex();
  return osm;
}

describe("SemanticNodeIndex", () => {
  it("indexes only classified point features without a full node spatial index", () => {
    const osm = semanticNodeOsm("semantic-index");
    expect(osm.nodes.hasSpatialIndex()).toBe(false);
    const findIndexesWithinBbox = vi.spyOn(osm.nodes, "findIndexesWithinBbox");

    const index = SemanticNodeIndex.build(osm);

    expect(index.size).toBe(3);
    expect(index.labelCount).toBe(2);
    expect(index.findIndexesWithinBbox([-1, -1, 1, 1])).toEqual([0, 1, 2]);
    expect(index.findLabelNodes([[-1, -1, 1, 1]], 4).map((node) => node.id)).toEqual([1]);
    expect(index.findLabelNodes([[-1, -1, 1, 1]], 14).map((node) => node.id)).toEqual([1]);
    expect(index.findLabelNodes([[-1, -1, 1, 1]], 15).map((node) => node.id)).toEqual([1, 2]);
    expect(
      index
        .findLabelNodes(
          [
            [-1, -1, 0.15, 1],
            [0.05, -1, 1, 1],
          ],
          15,
        )
        .map((node) => node.id),
    ).toEqual([1, 2]);
    expect(findIndexesWithinBbox).not.toHaveBeenCalled();
  });

  it("returns revisioned candidates through the worker without querying node KDBush", () => {
    const osm = semanticNodeOsm("worker-labels");
    const worker = new CliTileWorker();
    worker.transferIn(osm.transferables());

    const result = worker.getMapLabelCandidates(osm.id, {
      centerX: 0.5,
      centerY: 0.5,
      revision: 17,
      viewport: { width: 100, height: 60 },
      zoom: 4,
    });

    expect(result.revision).toBe(17);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: "place",
      stableKey: "node:1:point",
      text: "Center City",
    });
    worker.delete(osm.id);
  });

  it("retains a semantic index when the same shared dataset is transferred again", () => {
    const osm = semanticNodeOsm("worker-shared-labels");
    const worker = new CliTileWorker();
    worker.transferIn(osm.transferables());
    worker.buildSemanticNodeIndex(osm.id);
    const build = vi.spyOn(SemanticNodeIndex, "build");

    worker.transferIn(osm.transferables());
    worker.getMapLabelCandidates(osm.id, {
      centerX: 0.5,
      centerY: 0.5,
      revision: 1,
      viewport: { width: 100, height: 60 },
      zoom: 4,
    });

    expect(build).not.toHaveBeenCalled();
    worker.delete(osm.id);
  });

  it("shares compact point geometry without rebuilding it in tile workers", () => {
    const osm = semanticNodeOsm("shared-point-geometry");
    const original = SemanticNodeIndex.build(osm);
    const transferables = original.transferables();
    const restored = SemanticNodeIndex.fromTransferables(transferables);

    expect(restored.findIndexesWithinBbox([-1, -1, 1, 1]).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(restored.transferables().indexes).toBe(transferables.indexes);
    expect(restored.transferables().featureIndex.spatialIndex).toBe(
      transferables.featureIndex.spatialIndex,
    );
  });
});
