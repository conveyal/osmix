import Flatbush from "flatbush";
import { around } from "geoflatbush";
import { expect, test } from "vitest";

import { flatbushAround } from "../src/flatbush-around";

// Deterministic pseudo-random numbers in [0, 1).
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

function buildIndex(count: number, seed: number) {
  const next = random(seed);
  const index = new Flatbush(count);
  for (let i = 0; i < count; i++) {
    const lng = next() * 360 - 180;
    const lat = next() * 170 - 85;
    // Half points, half small boxes.
    const size = i % 2 ? next() * 2 : 0;
    index.add(lng, lat, Math.min(180, lng + size), Math.min(85, lat + size));
  }
  index.finish();
  return index;
}

test("flatbushAround matches geoflatbush", () => {
  const index = buildIndex(2000, 7);
  const next = random(11);
  for (let q = 0; q < 50; q++) {
    const lng = next() * 360 - 180;
    const lat = next() * 170 - 85;
    expect(flatbushAround(index, lng, lat)).toEqual(around(index, lng, lat));
    expect(flatbushAround(index, lng, lat, 10)).toEqual(around(index, lng, lat, 10));
    expect(flatbushAround(index, lng, lat, Infinity, 500)).toEqual(
      around(index, lng, lat, Infinity, 500),
    );
    const even = (i: number) => i % 2 === 0;
    expect(flatbushAround(index, lng, lat, 25, 2000, even)).toEqual(
      around(index, lng, lat, 25, 2000, even),
    );
  }
});

test("flatbushAround returns the nearest items first", () => {
  const index = new Flatbush(3);
  index.add(10, 10, 10, 10);
  index.add(0, 0, 0, 0);
  index.add(179.5, 0, 179.5, 0);
  index.finish();
  // Distances wrap across the antimeridian: (10, 10) is closer to -179.9 than (0, 0) is.
  expect(flatbushAround(index, -179.9, 0)).toEqual([2, 0, 1]);
  expect(flatbushAround(index, 1, 1, 1)).toEqual([1]);
  expect(flatbushAround(index, 1, 1, Infinity, 200)).toEqual([1]);
});
