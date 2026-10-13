import { clipPolygon, clipPolyline } from "@osmix/geo/lineclip";
import * as lineclip from "lineclip";
import { expect, test } from "vitest";

type Point = [number, number];
type Bbox = [number, number, number, number];

const bbox: Bbox = [0, 0, 10, 10];

// Deterministic pseudo-random points in [-5, 15) so lines cross every bbox edge.
function randomPoints(seed: number, count: number): Point[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return (state / 2 ** 31) * 20 - 5;
  };
  return Array.from({ length: count }, () => [next(), next()]);
}

test("clipPolyline splits a line that leaves and re-enters the bbox", () => {
  const line: Point[] = [
    [-5, 5],
    [5, 5],
    [5, 15],
    [8, 15],
    [8, 5],
  ];
  expect(clipPolyline(line, bbox)).toEqual([
    [
      [0, 5],
      [5, 5],
      [5, 10],
    ],
    [
      [8, 10],
      [8, 5],
    ],
  ]);
  expect(
    clipPolyline(
      [
        [20, 20],
        [30, 30],
      ],
      bbox,
    ),
  ).toEqual([]);
});

test("clipPolygon cuts a ring to the bbox", () => {
  const ring: Point[] = [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
    [-5, -5],
  ];
  expect(clipPolygon(ring, bbox)).toEqual([
    [0, 0],
    [5, 0],
    [5, 5],
    [0, 5],
  ]);
  expect(
    clipPolygon(
      [
        [20, 20],
        [30, 20],
        [30, 30],
        [20, 20],
      ],
      bbox,
    ),
  ).toEqual([]);
});

test("clipPolyline and clipPolygon match lineclip 2.0.0", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const points = randomPoints(seed, 2 + (seed % 12));
    expect(clipPolyline(points, bbox)).toEqual(lineclip.clipPolyline(points, bbox));
    const ring = [...points, points[0]!];
    expect(clipPolygon(ring, bbox)).toEqual(lineclip.clipPolygon(ring, bbox));
  }
});
