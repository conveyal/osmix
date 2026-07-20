import type { GeoBbox2D } from "@osmix/types";
import { describe, expect, it } from "vitest";

import { IndirectKdIndex } from "../src/indirect-kd-index.ts";
import { Nodes, SpatialIndexNotBuiltError } from "../src/nodes.ts";
import { Osm } from "../src/osm.ts";

const EARTH_RADIUS_KM = 6371.0088;

describe("indirect node spatial indexes", () => {
  it("stores exactly one Uint32 per indexed node", () => {
    const osm = new Osm();
    for (let i = 0; i < 10; i++) {
      osm.nodes.addNode({
        id: i + 1,
        lon: i,
        lat: i,
        ...(i % 3 === 0 ? { tags: { name: `${i}` } } : {}),
      });
    }
    osm.buildIndexes();
    osm.nodes.buildSpatialIndex("all");
    osm.nodes.buildSpatialIndex("tagged");

    const transferables = osm.nodes.transferables();
    expect(transferables.allSpatialIndex?.byteLength).toBe(10 * Uint32Array.BYTES_PER_ELEMENT);
    expect(transferables.taggedSpatialIndex?.byteLength).toBe(4 * Uint32Array.BYTES_PER_ELEMENT);
    expect(osm.nodes.taggedSize).toBe(4);
    expect(Nodes.getSpatialIndexBytesRequired(133_881_054)).toBe(535_524_216);
  });

  it("keeps all-node and tagged-node capabilities independent", () => {
    const osm = new Osm();
    osm.nodes.addNode({ id: 1, lon: 1, lat: 1, tags: { amenity: "bench" } });
    osm.nodes.addNode({ id: 2, lon: 2, lat: 2 });
    osm.nodes.addNode({ id: 3, lon: 3, lat: 3, tags: { name: "three" } });
    osm.buildIndexes();

    osm.nodes.buildSpatialIndex("tagged");
    expect(osm.nodes.hasSpatialIndex("tagged")).toBe(true);
    expect(osm.nodes.hasSpatialIndex("all")).toBe(false);
    expect(osm.nodes.findTaggedIndexesWithinBbox([-180, -90, 180, 90])).toEqual([0, 2]);
    expect(() => osm.nodes.findIndexesWithinBbox([-180, -90, 180, 90])).toThrowError(
      SpatialIndexNotBuiltError,
    );

    osm.nodes.buildSpatialIndex("all");
    expect(osm.nodes.findIndexesWithinBbox([-180, -90, 180, 90])).toEqual([0, 1, 2]);
  });

  it("throws a structured error when the requested capability is absent", () => {
    const osm = new Osm();
    osm.nodes.addNode({ id: 1, lon: 0, lat: 0 });
    osm.buildIndexes();

    let error: unknown;
    try {
      osm.nodes.findIndexesWithinRadius(0, 0, 1);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SpatialIndexNotBuiltError);
    expect(error).toMatchObject({
      name: "SpatialIndexNotBuiltError",
      code: "SPATIAL_INDEX_NOT_BUILT",
      entityType: "node",
      indexKind: "all",
    });
  });

  it("round-trips both capabilities through transferables, including empty indexes", () => {
    const source = new Osm();
    source.nodes.addNode({ id: 1, lon: -1, lat: -1, tags: { name: "one" } });
    source.nodes.addNode({ id: 2, lon: 1, lat: 1 });
    source.buildIndexes();
    source.nodes.buildSpatialIndex("all");
    source.nodes.buildSpatialIndex("tagged");

    const reconstructed = new Osm(source);
    expect(reconstructed.nodes.hasSpatialIndex("all")).toBe(true);
    expect(reconstructed.nodes.hasSpatialIndex("tagged")).toBe(true);
    expect(reconstructed.nodes.findIndexesWithinBbox([-2, -2, 2, 2])).toEqual([0, 1]);
    expect(reconstructed.nodes.findTaggedIndexesWithinBbox([-2, -2, 2, 2])).toEqual([0]);

    const empty = new Osm();
    empty.buildIndexes();
    empty.nodes.buildSpatialIndex("all");
    empty.nodes.buildSpatialIndex("tagged");
    const emptyReconstructed = new Osm(empty);
    expect(emptyReconstructed.nodes.hasSpatialIndex("all")).toBe(true);
    expect(emptyReconstructed.nodes.hasSpatialIndex("tagged")).toBe(true);
    expect(emptyReconstructed.nodes.findIndexesWithinBbox([-180, -90, 180, 90])).toEqual([]);
  });

  it("reconstructs a permutation from ArrayBuffer as well as SharedArrayBuffer", () => {
    const lons = new Int32Array([-1_000_000, 0, 1_000_000]);
    const lats = new Int32Array([-1_000_000, 0, 1_000_000]);
    const built = IndirectKdIndex.build(lons, lats, 3, (indexes) => indexes.set([0, 1, 2]));
    const arrayBuffer = new ArrayBuffer(built.buffer.byteLength);
    new Uint8Array(arrayBuffer).set(new Uint8Array(built.buffer));

    const reconstructed = IndirectKdIndex.from(lons, lats, arrayBuffer);
    expect(reconstructed.range(-1, -1, 1, 1)).toEqual([1]);
  });

  it("matches naive inclusive bbox scans across randomized data", () => {
    const osm = randomOsm(1_000);
    osm.nodes.buildSpatialIndex("all");

    const random = mulberry32(20260717);
    for (let i = 0; i < 100; i++) {
      const lonA = random() * 360 - 180;
      const lonB = random() * 360 - 180;
      const latA = random() * 180 - 90;
      const latB = random() * 180 - 90;
      const bbox: GeoBbox2D = [
        Math.min(lonA, lonB),
        Math.min(latA, latB),
        Math.max(lonA, lonB),
        Math.max(latA, latB),
      ];
      const expected = naiveBbox(osm, bbox);
      expect(osm.nodes.findIndexesWithinBbox(bbox).sort((a, b) => a - b)).toEqual(expected);
    }
  });

  it("matches naive haversine scans and orders equal distances by node index", () => {
    const osm = randomOsm(1_000, [
      { id: 10_001, lon: 1, lat: 0 },
      { id: 10_002, lon: -1, lat: 0 },
    ]);
    osm.nodes.buildSpatialIndex("all");

    const queries: [number, number, number][] = [
      [0, 0, 120],
      [179.8, 0, 500],
      [-73.9, 40.7, 1_000],
      [20, 89.8, 100],
      [0, -89.8, 100],
      [30, 20, Number.POSITIVE_INFINITY],
    ];
    for (const [lon, lat, radius] of queries) {
      expect(osm.nodes.findIndexesWithinRadius(lon, lat, radius)).toEqual(
        naiveRadius(osm, lon, lat, radius),
      );
    }

    const eastIndex = osm.nodes.ids.getIndexFromId(10_001);
    const westIndex = osm.nodes.ids.getIndexFromId(10_002);
    const equalDistanceResults = osm.nodes.findIndexesWithinRadius(0, 0, 112);
    expect(equalDistanceResults.indexOf(eastIndex)).toBeLessThan(
      equalDistanceResults.indexOf(westIndex),
    );
  });

  it("handles antimeridian-crossing bboxes and polar radii", () => {
    const osm = new Osm();
    osm.nodes.addNode({ id: 1, lon: 179.9, lat: 0 });
    osm.nodes.addNode({ id: 2, lon: -179.9, lat: 0 });
    osm.nodes.addNode({ id: 3, lon: 0, lat: 0 });
    osm.nodes.addNode({ id: 4, lon: 160, lat: 89.9 });
    osm.nodes.addNode({ id: 5, lon: -20, lat: 89.9 });
    osm.buildIndexes();
    osm.nodes.buildSpatialIndex("all");

    expect(osm.nodes.findIndexesWithinBbox([179, -1, -179, 1])).toEqual([0, 1]);
    expect(osm.nodes.findIndexesWithinRadius(179.95, 0, 20)).toEqual([0, 1]);
    expect(osm.nodes.findIndexesWithinRadius(70, 90, 20)).toEqual([3, 4]);
  });

  it("handles large runs of duplicate coordinates and inclusive boundaries", () => {
    const osm = new Osm();
    for (let i = 0; i < 256; i++) {
      osm.nodes.addNode({ id: i + 1, lon: 12.3456789, lat: -45.6789123 });
    }
    osm.nodes.addNode({ id: 257, lon: 12.345679, lat: -45.6789123 });
    osm.buildIndexes();
    osm.nodes.buildSpatialIndex("all");

    expect(
      osm.nodes.findIndexesWithinBbox([12.3456789, -45.6789123, 12.3456789, -45.6789123]),
    ).toHaveLength(256);
    expect(osm.nodes.findIndexesWithinRadius(12.3456789, -45.6789123, 0)).toEqual(
      Array.from({ length: 256 }, (_, index) => index),
    );
  });

  it("includes a stored microdegree coordinate on its exact floating-point boundary", () => {
    const osm = new Osm();
    const lon = -179.9382715;
    osm.nodes.addNode({ id: 1, lon, lat: 0 });
    osm.buildIndexes();
    osm.nodes.buildSpatialIndex("all");

    // This degree value does not multiply back to its stored integer exactly.
    expect((lon * 1e7) % 1).not.toBe(0);
    expect(osm.nodes.findIndexesWithinBbox([lon, 0, lon, 0])).toEqual([0]);
  });
});

function randomOsm(
  count: number,
  extraNodes: { id: number; lon: number; lat: number }[] = [],
): Osm {
  const osm = new Osm();
  const random = mulberry32(42);
  for (let i = 0; i < count; i++) {
    osm.nodes.addNode({
      id: i + 1,
      lon: random() * 360 - 180,
      lat: random() * 180 - 90,
      ...(i % 11 === 0 ? { tags: { name: `${i}` } } : {}),
    });
  }
  for (const node of extraNodes) osm.nodes.addNode(node);
  osm.buildIndexes();
  return osm;
}

function naiveBbox(osm: Osm, bbox: GeoBbox2D): number[] {
  const indexes: number[] = [];
  for (let i = 0; i < osm.nodes.size; i++) {
    const [lon, lat] = osm.nodes.getNodeLonLat({ index: i });
    const longitudeMatches =
      bbox[0] <= bbox[2] ? lon >= bbox[0] && lon <= bbox[2] : lon >= bbox[0] || lon <= bbox[2];
    if (longitudeMatches && lat >= bbox[1] && lat <= bbox[3]) indexes.push(i);
  }
  return indexes;
}

function naiveRadius(osm: Osm, lon: number, lat: number, radiusKm: number): number[] {
  const matches: { distance: number; index: number }[] = [];
  for (let i = 0; i < osm.nodes.size; i++) {
    const [nodeLon, nodeLat] = osm.nodes.getNodeLonLat({ index: i });
    const distance = haversineDistanceKm(lon, lat, nodeLon, nodeLat);
    if (distance <= radiusKm) matches.push({ distance, index: i });
  }
  matches.sort((a, b) => a.distance - b.distance || a.index - b.index);
  return matches.map(({ index }) => index);
}

function haversineDistanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const radians = Math.PI / 180;
  const latDelta = (lat2 - lat1) * radians;
  const lonDelta = (lon2 - lon1) * radians;
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.sin(lonDelta / 2) ** 2 * Math.cos(lat1 * radians) * Math.cos(lat2 * radians);
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
