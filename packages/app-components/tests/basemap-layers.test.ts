import { DEFAULT_BASEMAP_PRESET } from "@osmix/app-core";
import { describe, expect, it } from "vitest";

import {
  applyBasemapPreset,
  basemapLayerVisibility,
  classifyBasemapLayer,
} from "../src/lib/basemap-layers.ts";

const line = (id: string) => ({ id, type: "line" });
const symbol = (id: string) => ({ id, type: "symbol" });

describe("classifyBasemapLayer", () => {
  it("treats road, bridge, tunnel, rail and aeroway lines as roads", () => {
    for (const id of [
      "road_motorway",
      "bridge_motorway",
      "tunnel_minor",
      "rail",
      "rail_dash",
      "aeroway-runway",
    ]) {
      expect(classifyBasemapLayer(line(id)), id).toBe("road");
    }
  });

  it("treats road names and house numbers as road labels", () => {
    expect(classifyBasemapLayer(symbol("roadname_minor"))).toBe("roadLabel");
    expect(classifyBasemapLayer(symbol("housenumber"))).toBe("roadLabel");
  });

  it("treats every other symbol layer as a label", () => {
    for (const id of ["place_city_r6", "watername_ocean", "waterway_label", "poi_park"]) {
      expect(classifyBasemapLayer(symbol(id)), id).toBe("label");
    }
  });

  it("leaves fills, waterways, boundaries and buildings alone", () => {
    expect(classifyBasemapLayer(line("waterway"))).toBe("other");
    expect(classifyBasemapLayer(line("boundary_2"))).toBe("other");
    expect(classifyBasemapLayer({ id: "building", type: "fill" })).toBe("other");
    expect(classifyBasemapLayer({ id: "water", type: "fill" })).toBe("other");
  });

  it("never touches Osmix layers", () => {
    expect(classifyBasemapLayer(line("osmix:base:abc:overlay:ways"))).toBe("other");
    expect(classifyBasemapLayer(symbol("osmix:selected-points"))).toBe("other");
    expect(classifyBasemapLayer({ id: "osmix:base:abc:256:raster", type: "raster" })).toBe("other");
  });
});

describe("basemapLayerVisibility", () => {
  it("shows labels and hides roads by default", () => {
    expect(basemapLayerVisibility("label", DEFAULT_BASEMAP_PRESET)).toBe("visible");
    expect(basemapLayerVisibility("road", DEFAULT_BASEMAP_PRESET)).toBe("none");
    expect(basemapLayerVisibility("roadLabel", DEFAULT_BASEMAP_PRESET)).toBe("none");
    expect(basemapLayerVisibility("other", DEFAULT_BASEMAP_PRESET)).toBe("visible");
  });

  it("shows road labels only with both roads and labels", () => {
    expect(basemapLayerVisibility("roadLabel", { roads: true, labels: true })).toBe("visible");
    expect(basemapLayerVisibility("roadLabel", { roads: true, labels: false })).toBe("none");
    expect(basemapLayerVisibility("roadLabel", { roads: false, labels: true })).toBe("none");
  });

  it("hides every label when labels are off", () => {
    expect(basemapLayerVisibility("label", { roads: true, labels: false })).toBe("none");
    expect(basemapLayerVisibility("road", { roads: true, labels: false })).toBe("visible");
    expect(basemapLayerVisibility("other", { roads: false, labels: false })).toBe("visible");
  });
});

describe("applyBasemapPreset", () => {
  function fakeMap(layers: { id: string; type: string }[] | undefined) {
    const visibility = new Map<string, "visible" | "none">();
    const writes: [string, string][] = [];
    const map = {
      getStyle: () => (layers ? { layers } : undefined),
      getLayoutProperty: (id: string, _name: string) => visibility.get(id),
      setLayoutProperty: (id: string, _name: string, value: "visible" | "none") => {
        visibility.set(id, value);
        writes.push([id, value]);
      },
    };
    return { map: map as unknown as Parameters<typeof applyBasemapPreset>[0], writes, visibility };
  }

  it("does nothing before the style has layers", () => {
    const { map, writes } = fakeMap(undefined);
    applyBasemapPreset(map, DEFAULT_BASEMAP_PRESET);
    expect(writes).toEqual([]);
  });

  it("writes only the layers whose visibility changes and skips Osmix layers", () => {
    const { map, writes, visibility } = fakeMap([
      line("road_motorway"),
      symbol("place_city_r6"),
      { id: "water", type: "fill" },
      line("osmix:base:abc:overlay:ways"),
    ]);
    applyBasemapPreset(map, DEFAULT_BASEMAP_PRESET);
    expect(writes).toEqual([["road_motorway", "none"]]);
    expect(visibility.has("osmix:base:abc:overlay:ways")).toBe(false);

    applyBasemapPreset(map, { ...DEFAULT_BASEMAP_PRESET, roads: true });
    expect(writes).toEqual([
      ["road_motorway", "none"],
      ["road_motorway", "visible"],
    ]);
  });
});
