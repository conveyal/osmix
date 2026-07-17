import type { FeatureCollection, Point } from "geojson";
import { afterEach, describe, expect, it, vi } from "vitest";

const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));

vi.mock("shpjs", () => ({ default: parseMock }));

describe("Shapefile import without SharedArrayBuffer", () => {
  afterEach(() => {
    parseMock.mockReset();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("passes ArrayBuffer input to shpjs and builds indexes", async () => {
    const collection: FeatureCollection<Point> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [115.2167, -8.65] },
          properties: { name: "Denpasar" },
        },
      ],
    };
    parseMock.mockResolvedValue(collection);
    vi.stubGlobal("SharedArrayBuffer", undefined);
    vi.resetModules();

    const { fromShapefile } = await import("../src/osm-from-shapefile.ts");
    const input = new ArrayBuffer(8);
    const osm = await fromShapefile(input, {}, () => {});

    expect(parseMock).toHaveBeenCalledWith(input);
    expect(osm.nodes.getById(-1)?.tags?.["name"]).toBe("Denpasar");
  });
});
