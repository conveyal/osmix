import { pointToTile } from "@mapbox/tilebelt";
import { VectorTile } from "@mapbox/vector-tile";
import { Osm } from "@osmix/core";
import { fromPbf } from "@osmix/load";
import { inspectBackingBuffers } from "@osmix/shared/backing-buffers";
import { getFixtureFileReadStream, PBFs } from "@osmix/test-utils/fixtures";
import type { GeoBbox2D, Tile } from "@osmix/types";
import { PbfReader } from "pbf";
import { describe, expect, it } from "vitest";

import { ShortbreadVtEncoder } from "./encoder.ts";
import {
  getShortbreadFeatureIndexBuffers,
  SHORTBREAD_GEOMETRY_MASK,
  shortbreadFeatureHasLayer,
  ShortbreadFeatureIndex,
} from "./feature-index.ts";

function bboxToTile(bbox: GeoBbox2D, z = 14): Tile {
  const [minX, minY, maxX, maxY] = bbox;
  return pointToTile((minX + maxX) / 2, (minY + maxY) / 2, z);
}

function decodeTile(data: ArrayBuffer) {
  return new VectorTile(new PbfReader(data)).layers;
}

function decodedTileSnapshot(data: ArrayBuffer) {
  const layers = decodeTile(data);
  return Object.fromEntries(
    Object.entries(layers).map(([name, layer]) => [
      name,
      Array.from({ length: layer.length }, (_, index) => {
        const feature = layer.feature(index);
        return {
          geometry: feature.loadGeometry(),
          id: feature.id,
          properties: feature.properties,
          type: feature.type,
        };
      }),
    ]),
  );
}

function createMixedOsm(): Osm {
  const osm = new Osm();
  osm.nodes.addNode({
    id: 1,
    lat: 40.7,
    lon: -74,
    tags: { amenity: "restaurant", name: "Cafe" },
  });
  osm.nodes.addNode({ id: 2, lat: 40.7, lon: -74.01 });
  osm.nodes.addNode({ id: 3, lat: 40.71, lon: -74.01 });
  osm.nodes.addNode({ id: 4, lat: 40.71, lon: -74 });
  osm.nodes.addNode({ id: 5, lat: 40.705, lon: -74.005, tags: { unknown: "value" } });
  osm.ways.addWay({
    id: 10,
    refs: [2, 3, 4, 2],
    tags: { building: "yes", name: "Indexed Building" },
  });
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return osm;
}

describe("ShortbreadFeatureIndex", () => {
  it("stores only classified candidates and answers spatial queries", () => {
    const osm = createMixedOsm();
    const index = ShortbreadFeatureIndex.build(osm);
    const records = index.query(osm.bbox());

    expect(index.size).toBe(2);
    expect(records.map((record) => record.entityType)).toEqual(["node", "way"]);
    expect(shortbreadFeatureHasLayer(records[0]!, "pois")).toBe(true);
    expect(shortbreadFeatureHasLayer(records[1]!, "buildings")).toBe(true);
    expect(index.queryEntityIndexes(osm.bbox(), "node")).toEqual([0]);
    expect(index.queryEntityIndexes(osm.bbox(), "way", (entityIndex) => entityIndex > 0)).toEqual(
      [],
    );
    expect(index.query([0, 0, 1, 1])).toEqual([]);
  });

  it("filters query records before materializing them", () => {
    const osm = createMixedOsm();
    const index = ShortbreadFeatureIndex.build(osm);
    const bbox = osm.bbox();

    expect(index.query({ bbox })).toEqual(index.query(bbox));
    const buildings = index.query({
      bbox,
      entityTypes: ["way"],
      geometryMask: SHORTBREAD_GEOMETRY_MASK.POLYGON,
      layers: ["buildings"],
    });

    expect(buildings).toHaveLength(1);
    expect(buildings[0]?.entityType).toBe("way");
    expect(shortbreadFeatureHasLayer(buildings[0]!, "buildings")).toBe(true);
    expect(index.query({ bbox, entityTypes: ["node"], layers: ["buildings"] })).toHaveLength(0);
  });

  it("round-trips transferable state without copying shared buffers", () => {
    const index = ShortbreadFeatureIndex.build(createMixedOsm());
    const transferables = index.transferables();
    const restored = ShortbreadFeatureIndex.fromTransferables(transferables);
    const buffers = getShortbreadFeatureIndexBuffers(transferables);

    expect(restored.query([-180, -90, 180, 90])).toEqual(index.query([-180, -90, 180, 90]));
    expect(restored.backingBuffers()).toEqual(buffers);
    expect(new Set(buffers).size).toBe(buffers.length);
    const inspection = inspectBackingBuffers({ original: transferables, restored });
    expect(inspection.unique).toBe(buffers.length);
    if (typeof SharedArrayBuffer !== "undefined") {
      expect(buffers.every((buffer) => buffer instanceof SharedArrayBuffer)).toBe(true);
      expect(inspection.shared).toBe(buffers.length);
    }
  });

  it("produces byte-identical tiles through the optional indexed encoder path", () => {
    const osm = createMixedOsm();
    const tile = bboxToTile(osm.bbox());
    const featureIndex = ShortbreadFeatureIndex.build(osm);
    const unindexed = new Uint8Array(new ShortbreadVtEncoder(osm).getTile(tile));
    const indexed = new Uint8Array(
      new ShortbreadVtEncoder(osm, 4096, 64, featureIndex).getTile(tile),
    );
    const indexedWithOptions = new Uint8Array(
      new ShortbreadVtEncoder(osm, { featureIndex }).getTile(tile),
    );

    expect(indexed).toEqual(unindexed);
    expect(indexedWithOptions).toEqual(unindexed);
  });

  it("matches Monaco tile bytes across overview and detailed zooms", async () => {
    const osm = await fromPbf(getFixtureFileReadStream(PBFs["monaco"]!.url));
    const featureIndex = ShortbreadFeatureIndex.build(osm);
    const unindexed = new ShortbreadVtEncoder(osm);
    const indexed = new ShortbreadVtEncoder(osm, { featureIndex });

    for (const zoom of [10, 14]) {
      const tile = bboxToTile(osm.bbox(), zoom);
      const indexedTile = indexed.getTile(tile);
      const unindexedTile = unindexed.getTile(tile);
      expect(new Uint8Array(indexedTile)).toEqual(new Uint8Array(unindexedTile));
      expect(decodedTileSnapshot(indexedTile)).toEqual(decodedTileSnapshot(unindexedTile));
    }
  });

  it("suppresses a member area only when its classified relation supplies the geometry", () => {
    const osm = new Osm();
    osm.nodes.addNode({ id: 1, lat: 40.7, lon: -74 });
    osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74 });
    osm.nodes.addNode({ id: 3, lat: 40.71, lon: -74.01 });
    osm.nodes.addNode({ id: 4, lat: 40.7, lon: -74.01 });
    osm.ways.addWay({
      id: 10,
      refs: [1, 2, 3, 4, 1],
      tags: { natural: "water", name: "Member Lake" },
    });
    osm.relations.addRelation({
      id: 20,
      members: [{ type: "way", ref: 10, role: "outer" }],
      tags: { type: "multipolygon", natural: "water", name: "Relation Lake" },
    });
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    const index = ShortbreadFeatureIndex.build(osm);

    expect(index.suppressesWay(10)).toBe(true);
    expect(index.suppressesWay(10, "water")).toBe(true);
    expect(index.suppressesWay(10, "sites")).toBe(false);
    for (const encoder of [
      new ShortbreadVtEncoder(osm),
      new ShortbreadVtEncoder(osm, 4096, 64, index),
    ]) {
      const layers = decodeTile(encoder.getTile(bboxToTile(osm.bbox())));
      expect(layers["water"]?.length).toBe(1);
      expect(layers["water"]?.feature(0).properties["name"]).toBe("Relation Lake");
    }
  });

  it("retains independent member layers not supplied by the area relation", () => {
    const osm = new Osm();
    osm.nodes.addNode({ id: 1, lat: 40.7, lon: -74 });
    osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74 });
    osm.nodes.addNode({ id: 3, lat: 40.71, lon: -74.01 });
    osm.nodes.addNode({ id: 4, lat: 40.7, lon: -74.01 });
    osm.ways.addWay({
      id: 10,
      refs: [1, 2, 3, 4, 1],
      tags: { natural: "water", leisure: "park", name: "Member Park Lake" },
    });
    osm.relations.addRelation({
      id: 20,
      members: [{ type: "way", ref: 10, role: "outer" }],
      tags: { type: "multipolygon", natural: "water", name: "Relation Lake" },
    });
    osm.buildIndexes();
    osm.buildSpatialIndexes();

    const index = ShortbreadFeatureIndex.build(osm);
    const restored = ShortbreadFeatureIndex.fromTransferables(index.transferables());
    const tile = bboxToTile(osm.bbox());
    const unindexed = new Uint8Array(new ShortbreadVtEncoder(osm).getTile(tile));
    const indexed = new Uint8Array(
      new ShortbreadVtEncoder(osm, { featureIndex: restored }).getTile(tile),
    );

    expect(restored.suppressedLayerMaskForWay(10)).not.toBe(0);
    expect(restored.suppressesWay(10, "water")).toBe(true);
    expect(restored.suppressesWay(10, "sites")).toBe(false);
    expect(indexed).toEqual(unindexed);

    const layers = decodeTile(indexed.buffer as ArrayBuffer);
    expect(layers["water"]?.length).toBe(1);
    expect(layers["water"]?.feature(0).properties["name"]).toBe("Relation Lake");
    expect(layers["sites"]?.length).toBe(1);
    expect(layers["sites"]?.feature(0).properties["name"]).toBe("Member Park Lake");
  });

  it("does not suppress a valid road because it belongs to a route relation", () => {
    const osm = new Osm();
    osm.nodes.addNode({ id: 1, lat: 40.7, lon: -74 });
    osm.nodes.addNode({ id: 2, lat: 40.71, lon: -74.01 });
    osm.ways.addWay({
      id: 10,
      refs: [1, 2],
      tags: { highway: "primary", name: "Main Street" },
    });
    osm.relations.addRelation({
      id: 20,
      members: [{ type: "way", ref: 10, role: "" }],
      tags: { type: "route", route: "bus", name: "Bus 1" },
    });
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    const index = ShortbreadFeatureIndex.build(osm);

    expect(index.suppressesWay(10)).toBe(false);
    expect(index.suppressesWay(10, "streets")).toBe(false);
    for (const encoder of [
      new ShortbreadVtEncoder(osm),
      new ShortbreadVtEncoder(osm, 4096, 64, index),
    ]) {
      const layers = decodeTile(encoder.getTile(bboxToTile(osm.bbox())));
      expect(layers["streets"]?.length).toBe(1);
    }
  });
});
