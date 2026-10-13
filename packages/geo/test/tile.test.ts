import * as tilebelt from "@mapbox/tilebelt";
import { pointToTileFraction } from "@osmix/geo/tile";
import { expect, test } from "vitest";

test("pointToTileFraction matches @mapbox/tilebelt", () => {
  const points: [number, number][] = [
    [0, 0],
    [7.4246, 43.7384],
    [-122.4194, 37.7749],
    [180, 85],
    [-180, -85],
    [-181, 10],
    [540, -10],
  ];
  for (const [lon, lat] of points) {
    for (const z of [0, 1, 7, 14, 22]) {
      expect(pointToTileFraction(lon, lat, z)).toEqual(tilebelt.pointToTileFraction(lon, lat, z));
    }
  }
});

test("pointToTileFraction wraps x into the tile range", () => {
  const [x] = pointToTileFraction(-190, 0, 2);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThan(4);
});
