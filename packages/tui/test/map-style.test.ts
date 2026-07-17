import { describe, expect, it } from "vitest";

import { DARK_MAP_COLORS, resolveFeatureStyles } from "../src/map-style.ts";

describe("resolveFeatureStyles", () => {
  it("lifts feature colors while keeping the dark background anchored", () => {
    expect(DARK_MAP_COLORS.background).toEqual([7, 17, 13, 255]);
    expect(DARK_MAP_COLORS.vegetation).toEqual([59, 88, 74, 255]);
    expect(DARK_MAP_COLORS.residential).toEqual([181, 186, 181, 255]);
    expect(DARK_MAP_COLORS.motorway).toEqual([232, 143, 126, 255]);
    expect(DARK_MAP_COLORS.boundary).toEqual([158, 133, 167, 190]);
  });

  it("uses zoom-aware cased road hierarchy without duplicate label styles", () => {
    expect(resolveFeatureStyles({ highway: "motorway" }, "LineString", 6)).toEqual([]);
    const styles = resolveFeatureStyles({ highway: "motorway" }, "LineString", 16);

    expect(styles).toHaveLength(1);
    expect(styles[0]).toMatchObject({
      kind: "line",
      color: DARK_MAP_COLORS.motorway,
      width: 5,
      casingColor: DARK_MAP_COLORS.roadCasing,
      casingWidth: 7,
    });
  });

  it("shows uncased minor roads and rail in the low-zoom overview", () => {
    expect(resolveFeatureStyles({ highway: "tertiary" }, "LineString", 8)).toEqual([]);
    expect(resolveFeatureStyles({ highway: "tertiary" }, "LineString", 9)[0]).toMatchObject({
      kind: "line",
      width: 1,
      casingColor: undefined,
    });
    expect(resolveFeatureStyles({ highway: "residential" }, "LineString", 9)[0]).toMatchObject({
      kind: "line",
      width: 1,
      casingColor: undefined,
    });
    expect(resolveFeatureStyles({ highway: "service" }, "LineString", 9)).toEqual([]);
    expect(resolveFeatureStyles({ highway: "service" }, "LineString", 10)[0]).toMatchObject({
      kind: "line",
      width: 1,
      casingColor: undefined,
    });
    expect(resolveFeatureStyles({ railway: "rail" }, "LineString", 9)[0]).toMatchObject({
      kind: "line",
      width: 1,
      casingColor: undefined,
    });
  });

  it("adds buildings and semantic points only at their detail zooms", () => {
    expect(resolveFeatureStyles({ building: "yes" }, "Polygon", 12)).toEqual([]);
    expect(resolveFeatureStyles({ building: "yes" }, "Polygon", 13)[0]).toMatchObject({
      kind: "fill",
      color: DARK_MAP_COLORS.building,
      outlineColor: DARK_MAP_COLORS.buildingOutline,
    });

    expect(resolveFeatureStyles({ amenity: "hospital" }, "Point", 13)).toEqual([]);
    expect(resolveFeatureStyles({ amenity: "hospital" }, "Point", 14)[0]).toMatchObject({
      kind: "point",
      color: DARK_MAP_COLORS.medical,
      size: 1,
      symbol: "plus",
    });
    expect(resolveFeatureStyles({ amenity: "hospital" }, "Point", 16)[0]).toMatchObject({
      size: 2,
    });
  });

  it("classifies land colors and ignores unclassified or label-only geometry", () => {
    expect(resolveFeatureStyles({ natural: "wood" }, "Polygon", 10)[0]).toMatchObject({
      color: DARK_MAP_COLORS.vegetation,
    });
    expect(resolveFeatureStyles({ landuse: "industrial" }, "Polygon", 10)[0]).toMatchObject({
      color: DARK_MAP_COLORS.industrial,
    });
    expect(resolveFeatureStyles({ name: "Nowhere" }, "Point", 16)).toEqual([]);
    expect(resolveFeatureStyles({ source: "survey" }, "LineString", 16)).toEqual([]);
  });

  it("uses semantic colors instead of explicit OSM colour tags", () => {
    const [style] = resolveFeatureStyles(
      { highway: "primary", colour: "#00ff00" },
      "LineString",
      16,
    );
    expect(style).toMatchObject({ color: DARK_MAP_COLORS.primary });
  });

  it("orders tunnels below roads, bridges above them, and transit last", () => {
    const [tunnel] = resolveFeatureStyles({ highway: "primary", tunnel: "yes" }, "LineString", 14);
    const [road] = resolveFeatureStyles({ highway: "primary" }, "LineString", 14);
    const [bridge] = resolveFeatureStyles({ highway: "primary", bridge: "yes" }, "LineString", 14);
    const [rail] = resolveFeatureStyles({ railway: "rail" }, "LineString", 14);

    expect(tunnel!.order).toBeLessThan(road!.order);
    expect(road!.order).toBeLessThan(bridge!.order);
    expect(bridge!.order).toBeLessThan(rail!.order);
  });
});
