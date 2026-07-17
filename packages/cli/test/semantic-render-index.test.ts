import { pointToTileFraction } from "@osmix/geo/tile";
import { ShortbreadFeatureIndex } from "@osmix/shortbread";
import { getFixtureFileReadStream, PBFs } from "@osmix/test-utils";
import { fromPbf, Osm, type GeoBbox2D, type Tile } from "osmix";
import { describe, expect, it, vi } from "vitest";

import { SemanticRenderIndex } from "../src/semantic-render-index.ts";
import { drawStyledMapTile } from "../src/styled-tile.ts";
import { CliTileWorker } from "../src/tile-worker.ts";

function renderIndexOsm(): Osm {
  const osm = new Osm();
  osm.nodes.addNode({ id: 1, lon: -0.1, lat: -0.1 });
  osm.nodes.addNode({ id: 2, lon: 0.1, lat: -0.1 });
  osm.nodes.addNode({ id: 3, lon: 0.1, lat: 0.1 });
  osm.nodes.addNode({ id: 4, lon: -0.1, lat: 0.1 });
  osm.ways.addWay({ id: 10, refs: [1, 2], tags: { highway: "primary" } });
  osm.ways.addWay({ id: 11, refs: [2, 3], tags: { highway: "footway" } });
  osm.ways.addWay({ id: 12, refs: [1, 2, 3, 4, 1], tags: { building: "yes" } });
  osm.ways.addWay({ id: 13, refs: [3, 4] });
  osm.relations.addRelation({
    id: 20,
    members: [{ type: "way", ref: 10, role: "" }],
    tags: { boundary: "administrative", admin_level: "2", type: "boundary" },
  });
  osm.buildIndexes();
  osm.ways.buildSpatialIndex();
  osm.relations.buildSpatialIndex();
  return osm;
}

describe("SemanticRenderIndex", () => {
  it("filters geometry spatial searches using compact minimum-zoom bitsets", () => {
    const osm = renderIndexOsm();
    const index = SemanticRenderIndex.build(osm);
    const bbox: GeoBbox2D = [-1, -1, 1, 1];
    const waySearch = vi.spyOn(osm.ways, "intersects");
    const relationSearch = vi.spyOn(osm.relations, "intersects");

    expect(index.ways(osm.ways, 8).intersects(bbox)).toEqual([0]);
    expect(index.ways(osm.ways, 13).intersects(bbox)).toEqual([0, 2]);
    expect(index.ways(osm.ways, 14).intersects(bbox)).toEqual([0, 1, 2]);
    expect(index.relations(osm.relations, 3).intersects(bbox)).toEqual([]);
    // The boundary relation has area geometry but no Shortbread polygon classification.
    expect(index.relations(osm.relations, 4).intersects(bbox)).toEqual([]);
    expect(waySearch).not.toHaveBeenCalled();
    expect(relationSearch).not.toHaveBeenCalled();
  });

  it("reuses shared bitset buffers in tile workers", () => {
    const osm = renderIndexOsm();
    const original = SemanticRenderIndex.build(osm);
    const transferables = original.transferables();
    const restored = SemanticRenderIndex.fromTransferables(transferables);

    expect(restored.ways(osm.ways, 8).intersects([-1, -1, 1, 1])).toEqual([0]);
    expect(restored.transferables().ways).toBe(transferables.ways);
    expect(restored.transferables().relations).toBe(transferables.relations);
  });

  it("shares one Shortbread candidate index across worker-owned overlays", () => {
    const osm = renderIndexOsm();
    const source = new CliTileWorker();
    source.transferIn(osm.transferables());
    source.buildShortbreadFeatureIndex(osm.id);
    const transferables = source.getShortbreadFeatureIndexTransferables(osm.id);

    const target = new CliTileWorker();
    target.transferIn(osm.transferables());
    target.setShortbreadFeatureIndex(osm.id, osm.contentHash(), transferables);
    const build = vi.spyOn(ShortbreadFeatureIndex, "build");
    target.buildSemanticRenderIndex(osm.id);
    target.buildSemanticNodeIndex(osm.id);
    target.buildSemanticLabelIndex(osm.id);

    expect(build).not.toHaveBeenCalled();
    const restored = target.getShortbreadFeatureIndexTransferables(osm.id);
    expect(restored.entityIndexes).toBe(transferables.entityIndexes);
    expect(restored.spatialIndex).toBe(transferables.spatialIndex);
    source.delete(osm.id);
    target.delete(osm.id);
  });

  it("preserves fixture-backed styled output across overview and detailed zooms", async () => {
    const osm = await fromPbf(getFixtureFileReadStream(PBFs["monaco"]!.url));
    const index = SemanticRenderIndex.build(osm);
    for (const zoom of [10, 14]) {
      const [tileX, tileY] = pointToTileFraction(7.42, 43.74, zoom);
      const tile: Tile = [Math.floor(tileX), Math.floor(tileY), zoom];
      const expected = drawStyledMapTile(osm, tile, 64).imageData;
      const actual = drawStyledMapTile(osm, tile, 64, undefined, {
        relations: index.relations(osm.relations, zoom),
        ways: index.ways(osm.ways, zoom),
      }).imageData;
      expect(actual).toEqual(expected);
    }
  });
});
