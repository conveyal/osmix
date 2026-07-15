import type { Tile } from "osmix";
import { describe, expect, it } from "vitest";

import { MapCamera, TILE_SIZE } from "../src/camera.ts";
import { MAP_BACKGROUND, renderMapPixels } from "../src/map-pixels.ts";

function solidTile(red: number, green: number, blue: number, alpha: number) {
  const data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = alpha;
  }
  return { data };
}

describe("renderMapPixels", () => {
  it("composites raster alpha over the map background", () => {
    const pixels = renderMapPixels(new MapCamera(0.5, 0.5, 0), { width: 2, height: 2 }, () =>
      solidTile(207, 117, 13, 128),
    );
    expect(Array.from(pixels.slice(0, 4))).toEqual([107, 67, 13, 255]);
  });

  it("leaves transparent raster pixels at the map background", () => {
    const pixels = renderMapPixels(new MapCamera(0.5, 0.5, 0), { width: 1, height: 1 }, () =>
      solidTile(255, 255, 255, 0),
    );
    expect([...pixels]).toEqual([...MAP_BACKGROUND, 255]);
  });

  it("wraps horizontal world tiles before requesting raster data", () => {
    const requested: Tile[] = [];
    const getTile = (tile: Tile) => {
      requested.push(tile);
      return solidTile(0, 0, 0, 0);
    };
    renderMapPixels(new MapCamera(0, 0.5, 0), { width: 4, height: 1 }, getTile);
    expect(requested.length).toBeGreaterThan(0);
    for (const tile of requested) expect(tile[0]).toBe(0);
  });
});
