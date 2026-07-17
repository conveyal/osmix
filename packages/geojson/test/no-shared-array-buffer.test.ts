import { afterEach, describe, expect, it, vi } from "vitest";

describe("GeoJSON without SharedArrayBuffer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reads binary GeoJSON into ArrayBuffer-backed indexes", async () => {
    vi.stubGlobal("SharedArrayBuffer", undefined);
    vi.resetModules();

    const { fromGeoJSON } = await import("../src/osm-from-geojson.ts");
    const input = new TextEncoder().encode(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [115.2167, -8.65] },
            properties: { name: "Denpasar" },
          },
        ],
      }),
    ).buffer;

    const osm = await fromGeoJSON(input);

    expect(osm.nodes.getById(-1)?.tags?.["name"]).toBe("Denpasar");
  });
});
