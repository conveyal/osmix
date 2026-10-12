import { pointToTile } from "@mapbox/tilebelt";
import { Osm } from "@osmix/core";
import { describe, expect, it } from "vitest";

import { drawToRasterTile } from "../src/raster";

describe("drawToRasterTile", () => {
  it("uses tagged colors for ways", () => {
    const osm = new Osm();
    osm.nodes.addNode({ id: 1, lat: 40, lon: -74 });
    osm.nodes.addNode({ id: 2, lat: 40.001, lon: -74.001 });
    osm.ways.addWay({
      id: 3,
      refs: [1, 2],
      tags: { highway: "service", color: "00FF00" },
    });
    osm.buildIndexes();
    osm.buildSpatialIndexes();

    const tile = pointToTile(-74, 40, 12);
    const rasterTile = drawToRasterTile(osm, tile, { tileSize: 64 });
    const imageData = rasterTile.imageData;
    let found = false;

    for (let i = 0; i < imageData.length; i += 4) {
      const alpha = imageData[i + 3];
      if (!alpha) continue;
      found = true;
      expect(imageData[i]).toBe(0);
      expect(imageData[i + 1]).toBe(255);
      expect(imageData[i + 2]).toBe(0);
      // Alpha varies based on subpixel coverage, just verify it's non-zero
      expect(imageData[i + 3]).toBeGreaterThan(0);
      break;
    }

    expect(found).toBe(true);
  });

  it("uses the line color option for relation lines", () => {
    const osm = new Osm();
    osm.nodes.addNode({ id: 1, lat: 40, lon: -74 });
    osm.nodes.addNode({ id: 2, lat: 40.001, lon: -74.001 });
    osm.ways.addWay({ id: 3, refs: [1, 2], tags: { highway: "service" } });
    osm.relations.addRelation({
      id: 4,
      members: [{ type: "way", ref: 3, role: "" }],
      tags: { type: "route", route: "bus" },
    });
    osm.buildIndexes();
    osm.buildSpatialIndexes();

    const tile = pointToTile(-74, 40, 12);
    const lineColor = [10, 20, 30, 255] as const;
    const { imageData } = drawToRasterTile(osm, tile, { tileSize: 256, lineColor: [...lineColor] });
    const colored: number[][] = [];
    for (let i = 0; i < imageData.length; i += 4) {
      if (imageData[i + 3]) colored.push([imageData[i]!, imageData[i + 1]!, imageData[i + 2]!]);
    }

    expect(colored.length).toBeGreaterThan(0);
    for (const rgb of colored) expect(rgb).toEqual([10, 20, 30]);
  });
});
