import { describe, expect, it } from "vitest";

import { compareResults, scanGeoJSONFeatures } from "../src/harness/compare";

const collection = (...features: object[]) =>
  JSON.stringify({ type: "FeatureCollection", features });

const point = (id: number, tags: object = {}) => ({
  type: "Feature",
  id,
  osm_type: "node",
  geometry: { type: "Point", coordinates: [1.5, 2.5] },
  properties: tags,
});

const line = (id: number, length: number) => ({
  type: "Feature",
  id,
  osm_type: "way",
  geometry: {
    type: "LineString",
    coordinates: Array.from({ length }, (_, i) => [i, -i]),
  },
  properties: { highway: "path" },
});

describe("scanGeoJSONFeatures", () => {
  it("reads keys and coordinate counts", () => {
    const text = collection(point(1, { name: '{"type":"Feature"' }), line(2, 3), line(3, 2));
    expect(scanGeoJSONFeatures(text)).toEqual(
      new Map([
        ["node/1", "1"],
        ["way/2", "3"],
        ["way/3", "2"],
      ]),
    );
  });

  it("rejects features in an unexpected shape", () => {
    const text = collection({ type: "Feature", geometry: null, properties: {} });
    expect(() => scanGeoJSONFeatures(text)).toThrow("Unexpected GeoJSON feature");
  });

  it("rejects duplicate features", () => {
    expect(() => scanGeoJSONFeatures(collection(point(1), point(1)))).toThrow("Duplicate");
  });
});

describe("compareResults", () => {
  it("accepts the same ids in any order", () => {
    const parity = compareResults(
      { kind: "ids", ids: Float64Array.of(3, 1, 2) },
      { kind: "ids", ids: Float64Array.of(1, 2, 3) },
    );
    expect(parity).toMatchObject({ equal: true, osmix: "3 ids", duckdb: "3 ids" });
  });

  it("describes ids only one engine returned", () => {
    const parity = compareResults(
      { kind: "ids", ids: Float64Array.of(1, 2) },
      { kind: "ids", ids: Float64Array.of(2, 3) },
    );
    expect(parity.equal).toBe(false);
    expect(parity.diff).toBe("Osmix only (1): 1\nDuckDB only (1): 3");
  });

  it("compares aggregate counts", () => {
    const parity = compareResults(
      { kind: "groups", values: ["a", "b"], counts: [2, 1] },
      { kind: "groups", values: ["b", "a"], counts: [1, 3] },
    );
    expect(parity.diff).toBe("Different (1): a (2 vs 3)");
  });

  it("compares GeoJSON coordinate counts", () => {
    const parity = compareResults(
      { kind: "geojson", text: collection(line(2, 3)) },
      { kind: "geojson", text: collection(line(2, 4)) },
    );
    expect(parity.diff).toBe("Different (1): way/2 (3 vs 4)");
  });
});
