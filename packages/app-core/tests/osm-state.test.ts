import { createStore } from "jotai";
import { Osm, type OsmNode } from "osmix";
import { describe, expect, it } from "vitest";

import {
  selectedEntityAtom,
  selectedOsmAtom,
  selectionOriginAtom,
  selectOsmEntityAtom,
} from "../src/state/osm.ts";

const node: OsmNode = { id: 1, lon: 7.42, lat: 43.73 };

describe("selectOsmEntityAtom", () => {
  it("selects with an `other` origin by default", () => {
    const store = createStore();
    const osm = new Osm({ id: "select" });
    store.set(selectOsmEntityAtom, osm, node);
    expect(store.get(selectedOsmAtom)).toBe(osm);
    expect(store.get(selectedEntityAtom)).toBe(node);
    expect(store.get(selectionOriginAtom)).toEqual({ source: "other" });
  });

  it("records a map click's point", () => {
    const store = createStore();
    const osm = new Osm({ id: "select" });
    store.set(selectOsmEntityAtom, osm, node, { source: "map", point: [1300, 20] });
    expect(store.get(selectionOriginAtom)).toEqual({ source: "map", point: [1300, 20] });
  });

  it("resets the origin on the next selection", () => {
    const store = createStore();
    const osm = new Osm({ id: "select" });
    store.set(selectOsmEntityAtom, osm, node, { source: "map", point: [1300, 20] });
    store.set(selectOsmEntityAtom, null, null);
    expect(store.get(selectedEntityAtom)).toBeNull();
    expect(store.get(selectionOriginAtom)).toEqual({ source: "other" });
  });
});
