import { describe, expect, it } from "vitest";

import { lonLatToWorld, MapCamera, worldToLonLat } from "../src/camera.ts";

describe("MapCamera", () => {
  it("fits bounds and centers the dataset", () => {
    const camera = MapCamera.fitBounds([7.4, 43.72, 7.44, 43.75], {
      width: 100,
      height: 46,
    });
    const [lon, lat] = camera.center;
    expect(lon).toBeCloseTo(7.42, 2);
    expect(lat).toBeCloseTo(43.735, 2);
    expect(camera.zoom).toBeGreaterThanOrEqual(10);
  });

  it("preserves the coordinate beneath an off-center zoom anchor", () => {
    const viewport = { width: 100, height: 50 };
    const anchor = { x: 20, y: 10 };
    const camera = new MapCamera(0.55, 0.45, 8);
    const beforeOrigin = camera.origin(viewport);
    const before = {
      x: (beforeOrigin.x + anchor.x) / camera.worldSize,
      y: (beforeOrigin.y + anchor.y) / camera.worldSize,
    };
    camera.zoomBy(1, viewport, anchor);
    const afterOrigin = camera.origin(viewport);
    const after = {
      x: (afterOrigin.x + anchor.x) / camera.worldSize,
      y: (afterOrigin.y + anchor.y) / camera.worldSize,
    };
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it("round-trips projected coordinates", () => {
    const coordinate: [number, number] = [7.420_56, 43.732_1];
    expect(worldToLonLat(lonLatToWorld(coordinate))).toEqual([
      expect.closeTo(coordinate[0], 8),
      expect.closeTo(coordinate[1], 8),
    ]);
  });

  it("wraps horizontal pans and clamps vertical pans", () => {
    const camera = new MapCamera(0.99, 0.99, 0);
    camera.panPixels(20, 1000);
    expect(camera.centerX).toBeGreaterThanOrEqual(0);
    expect(camera.centerX).toBeLessThan(1);
    expect(camera.centerY).toBe(1);
  });

  it("projects the nearest world copy across the antimeridian", () => {
    const center = lonLatToWorld([179.5, 0]);
    const camera = new MapCamera(center.x, center.y, 4);
    const projected = camera.project([-179.5, 0], { width: 100, height: 50 });

    expect(projected.x).toBeGreaterThan(50);
    expect(projected.x).toBeLessThan(70);
    expect(projected.y).toBeCloseTo(25, 4);
  });

  it("splits visible geographic bounds at the antimeridian", () => {
    const center = lonLatToWorld([179.5, 0]);
    const camera = new MapCamera(center.x, center.y, 4);
    const bboxes = camera.visibleBboxes({ width: 100, height: 50 });

    expect(bboxes).toHaveLength(2);
    expect(bboxes[0]![2]).toBe(180);
    expect(bboxes[1]![0]).toBe(-180);
    expect(bboxes[0]![1]).toBeLessThan(bboxes[0]![3]);
  });
});
