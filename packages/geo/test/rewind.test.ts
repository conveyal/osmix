import { rewindFeature, rewindGeometry, rewindRing } from "@osmix/geo/rewind";
import type { Polygon } from "geojson";
import { expect, test } from "vitest";

const ccw = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];
const cw = ccw.slice().reverse();

test("rewindRing keeps a ring that already has the winding", () => {
  expect(rewindRing(ccw, false)).toBe(ccw);
  expect(rewindRing(cw, true)).toBe(cw);
});

test("rewindRing reverses a copy of a ring with the other winding", () => {
  expect(rewindRing(cw, false)).toEqual(ccw);
  expect(rewindRing(ccw, true)).toEqual(cw);
  expect(cw[1]).toEqual([0, 1]);
});

test("rewindGeometry winds outer rings counterclockwise and holes clockwise", () => {
  const polygon: Polygon = { type: "Polygon", coordinates: [cw, ccw] };
  expect(rewindGeometry(polygon)).toEqual({ type: "Polygon", coordinates: [ccw, cw] });
  expect(polygon.coordinates).toEqual([cw, ccw]);

  expect(rewindGeometry({ type: "MultiPolygon", coordinates: [[cw], [cw, ccw]] })).toEqual({
    type: "MultiPolygon",
    coordinates: [[ccw], [ccw, cw]],
  });
  expect(rewindGeometry({ type: "GeometryCollection", geometries: [polygon] })).toEqual({
    type: "GeometryCollection",
    geometries: [{ type: "Polygon", coordinates: [ccw, cw] }],
  });
});

test("rewindGeometry returns other geometries unchanged", () => {
  const line = { type: "LineString" as const, coordinates: cw };
  expect(rewindGeometry(line)).toBe(line);
});

test("rewindFeature rewinds the geometry and keeps other members", () => {
  const feature = {
    type: "Feature" as const,
    id: 7,
    properties: { name: "a" },
    geometry: { type: "Polygon" as const, coordinates: [cw] },
  };
  expect(rewindFeature(feature)).toEqual({
    ...feature,
    geometry: { type: "Polygon", coordinates: [ccw] },
  });

  const empty = { type: "Feature" as const, properties: null, geometry: null };
  expect(rewindFeature(empty)).toBe(empty);
});
