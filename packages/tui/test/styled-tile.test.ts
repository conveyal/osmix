import { pointToTileFraction } from "@osmix/geo/tile";
import { getFixtureFileReadStream, PBFs } from "@osmix/test-utils";
import { fromPbf, Osm, OsmixRasterTile, type LonLat, type Rgba, type Tile, type XY } from "osmix";
import { describe, expect, it, vi } from "vitest";

import { DARK_MAP_COLORS } from "../src/map-style.ts";
import { drawStyledMapTile, drawStyledMapTileAsync } from "../src/styled-tile.ts";

function tileAt(lon: number, lat: number, zoom: number): Tile {
  const [x, y] = pointToTileFraction(lon, lat, zoom);
  return [Math.floor(x), Math.floor(y), zoom];
}

function addWayAtPixels(
  osm: Osm,
  projector: OsmixRasterTile,
  id: number,
  pixels: XY[],
  tags: Record<string, string>,
): void {
  const refs: number[] = [];
  for (const [index, pixel] of pixels.entries()) {
    if (index === pixels.length - 1 && pixel[0] === pixels[0]?.[0] && pixel[1] === pixels[0]?.[1]) {
      refs.push(refs[0]!);
      continue;
    }
    const nodeId = id * 100 + index;
    const [lon, lat] = projector.tilePxToLonLat(pixel);
    osm.nodes.addNode({ id: nodeId, lon, lat });
    refs.push(nodeId);
  }
  osm.ways.addWay({ id, refs, tags });
}

function pixel(tile: OsmixRasterTile, xy: XY): number[] {
  const index = tile.getIndex(xy);
  return Array.from(tile.imageData.slice(index, index + 4));
}

function countColor(tile: OsmixRasterTile, color: Rgba): number {
  let count = 0;
  for (let offset = 0; offset < tile.imageData.length; offset += 4) {
    if (
      tile.imageData[offset] === color[0] &&
      tile.imageData[offset + 1] === color[1] &&
      tile.imageData[offset + 2] === color[2]
    ) {
      count++;
    }
  }
  return count;
}

function buildNonNodeSpatialIndexes(osm: Osm): void {
  osm.buildIndexes();
  osm.ways.buildSpatialIndex();
  osm.relations.buildSpatialIndex();
}

describe("drawStyledMapTile", () => {
  it("draws semantic areas, cased roads, buildings, and points in layer order", () => {
    const tileIndex = tileAt(0, 0, 14);
    const tileSize = 128;
    const projector = new OsmixRasterTile({ tile: tileIndex, tileSize });
    const osm = new Osm();

    addWayAtPixels(
      osm,
      projector,
      2,
      [
        [10, 10],
        [50, 10],
        [50, 50],
        [10, 50],
        [10, 10],
      ],
      {
        natural: "water",
      },
    );
    addWayAtPixels(
      osm,
      projector,
      3,
      [
        [70, 70],
        [100, 70],
        [100, 100],
        [70, 100],
        [70, 70],
      ],
      {
        building: "yes",
      },
    );
    addWayAtPixels(
      osm,
      projector,
      5,
      [
        [10, 70],
        [50, 70],
        [50, 110],
        [10, 110],
        [10, 70],
      ],
      {
        natural: "wood",
      },
    );
    addWayAtPixels(
      osm,
      projector,
      4,
      [
        [4, 30],
        [124, 30],
      ],
      { highway: "primary" },
    );
    const hospital: LonLat = projector.tilePxToLonLat([110, 110]);
    osm.nodes.addNode({
      id: 999,
      lon: hospital[0],
      lat: hospital[1],
      tags: { amenity: "hospital" },
    });
    osm.buildIndexes();
    osm.buildSpatialIndexes();

    const rendered = drawStyledMapTile(osm, tileIndex, tileSize);

    expect(countColor(rendered, DARK_MAP_COLORS.water)).toBeGreaterThan(0);
    expect(countColor(rendered, DARK_MAP_COLORS.vegetation)).toBeGreaterThan(0);
    expect(pixel(rendered, [80, 80])).toEqual(DARK_MAP_COLORS.building);
    expect(pixel(rendered, [60, 30])).toEqual(DARK_MAP_COLORS.primary);
    expect(pixel(rendered, [60, 28])).toEqual(DARK_MAP_COLORS.roadCasing);
    expect(countColor(rendered, DARK_MAP_COLORS.medical)).toBe(5);
  });

  it("adds minor road detail as the map zooms in", () => {
    const osm = new Osm();
    const closeTile = tileAt(0, 0, 14);
    const closeProjector = new OsmixRasterTile({ tile: closeTile, tileSize: 64 });
    addWayAtPixels(
      osm,
      closeProjector,
      1,
      [
        [4, 32],
        [60, 32],
      ],
      { highway: "service" },
    );
    osm.buildIndexes();
    osm.buildSpatialIndexes();

    const hiddenTile = tileAt(0, 0, 9);
    const overviewTile = tileAt(0, 0, 10);
    const hidden = drawStyledMapTile(osm, hiddenTile, 64);
    const overview = drawStyledMapTile(osm, overviewTile, 64);
    const close = drawStyledMapTile(osm, closeTile, 64);

    expect(countColor(hidden, DARK_MAP_COLORS.service)).toBe(0);
    expect(countColor(overview, DARK_MAP_COLORS.service)).toBeGreaterThan(0);
    expect(countColor(close, DARK_MAP_COLORS.service)).toBeGreaterThan(0);
  });

  it("filters hidden ways before retrieving their coordinates", () => {
    const osm = new Osm();
    const closeTile = tileAt(0, 0, 14);
    const projector = new OsmixRasterTile({ tile: closeTile, tileSize: 64 });
    addWayAtPixels(
      osm,
      projector,
      1,
      [
        [4, 32],
        [60, 32],
      ],
      { highway: "service" },
    );
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    const getFullEntity = vi.spyOn(osm.ways, "getFullEntity");
    const getCoordinates = vi.spyOn(osm.ways, "getCoordinates");

    drawStyledMapTile(osm, tileAt(0, 0, 9), 64);
    expect(getFullEntity).not.toHaveBeenCalled();
    expect(getCoordinates).not.toHaveBeenCalled();

    drawStyledMapTile(osm, tileAt(0, 0, 10), 64);
    expect(getFullEntity).toHaveBeenCalledTimes(1);
    expect(getCoordinates).toHaveBeenCalledTimes(1);
  });

  it("does not require a node spatial index below the semantic point zoom", () => {
    const tileIndex = tileAt(0, 0, 13);
    const projector = new OsmixRasterTile({ tile: tileIndex, tileSize: 64 });
    const osm = new Osm();
    const hospital = projector.tilePxToLonLat([32, 32]);
    osm.nodes.addNode({
      id: 1,
      lon: hospital[0],
      lat: hospital[1],
      tags: { amenity: "hospital" },
    });
    buildNonNodeSpatialIndexes(osm);
    const findNodes = vi.spyOn(osm.nodes, "findIndexesWithinBbox");

    expect(osm.nodes.hasSpatialIndex()).toBe(false);
    expect(() => drawStyledMapTile(osm, tileIndex, 64)).not.toThrow();
    expect(findNodes).not.toHaveBeenCalled();
  });

  it("uses a compact node-index provider for close-zoom semantic points", () => {
    const tileIndex = tileAt(0, 0, 14);
    const projector = new OsmixRasterTile({ tile: tileIndex, tileSize: 64 });
    const osm = new Osm();
    const hospital = projector.tilePxToLonLat([32, 32]);
    osm.nodes.addNode({
      id: 1,
      lon: hospital[0],
      lat: hospital[1],
      tags: { amenity: "hospital" },
    });
    buildNonNodeSpatialIndexes(osm);
    const nodeIndexProvider = { findIndexesWithinBbox: vi.fn(() => [0]) };

    const rendered = drawStyledMapTile(osm, tileIndex, 64, nodeIndexProvider);

    expect(osm.nodes.hasSpatialIndex()).toBe(false);
    expect(nodeIndexProvider.findIndexesWithinBbox).toHaveBeenCalledTimes(1);
    expect(countColor(rendered, DARK_MAP_COLORS.medical)).toBe(5);
  });

  it("keeps roads that are members of unclassified route relations", () => {
    const tileIndex = tileAt(0, 0, 14);
    const projector = new OsmixRasterTile({ tile: tileIndex, tileSize: 64 });
    const osm = new Osm();
    addWayAtPixels(
      osm,
      projector,
      1,
      [
        [4, 32],
        [60, 32],
      ],
      { highway: "secondary" },
    );
    osm.relations.addRelation({
      id: 2,
      members: [{ type: "way", ref: 1, role: "" }],
      tags: { type: "route", route: "hiking" },
    });
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    const getRelation = vi.spyOn(osm.relations, "getByIndex");
    const getRelationGeometry = vi.spyOn(osm.relations, "getRelationGeometry");

    const rendered = drawStyledMapTile(osm, tileIndex, 64);
    expect(countColor(rendered, DARK_MAP_COLORS.secondary)).toBeGreaterThan(0);
    expect(getRelation).not.toHaveBeenCalled();
    expect(getRelationGeometry).not.toHaveBeenCalled();
  });

  it("preserves synchronous output while the cooperative renderer yields in chunks", async () => {
    const tileIndex = tileAt(0, 0, 14);
    const projector = new OsmixRasterTile({ tile: tileIndex, tileSize: 64 });
    const osm = new Osm();
    addWayAtPixels(
      osm,
      projector,
      1,
      [
        [4, 32],
        [60, 32],
      ],
      { highway: "primary" },
    );
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    let yields = 0;

    const synchronous = drawStyledMapTile(osm, tileIndex, 64);
    const cooperative = await drawStyledMapTileAsync(
      osm,
      tileIndex,
      64,
      undefined,
      {},
      () => false,
      {
        chunkBudgetMs: 0,
        yieldToEventLoop: () => {
          yields++;
          return Promise.resolve();
        },
      },
    );

    expect(yields).toBeGreaterThan(0);
    expect(cooperative.imageData).toEqual(synchronous.imageData);
  });

  it("yields a macrotask so a non-shared cancellation message can stop stale work", async () => {
    const tileIndex = tileAt(0, 0, 14);
    const projector = new OsmixRasterTile({ tile: tileIndex, tileSize: 64 });
    const osm = new Osm();
    addWayAtPixels(
      osm,
      projector,
      1,
      [
        [4, 32],
        [60, 32],
      ],
      { highway: "primary" },
    );
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 0);

    const rendered = await drawStyledMapTileAsync(
      osm,
      tileIndex,
      64,
      undefined,
      {},
      () => cancelled,
      { chunkBudgetMs: 0 },
    );

    expect(cancelled).toBe(true);
    expect(countColor(rendered, DARK_MAP_COLORS.primary)).toBe(0);
  });

  it("renders semantic detail from the Monaco PBF fixture", async () => {
    const osm = await fromPbf(getFixtureFileReadStream(PBFs["monaco"]!.url));
    const streetTile = drawStyledMapTile(osm, [17_059, 11_948, 15], 128);
    const buildingTile = drawStyledMapTile(osm, [68_236, 47_796, 17], 256);

    expect(countColor(streetTile, DARK_MAP_COLORS.primary)).toBeGreaterThan(0);
    expect(countColor(streetTile, DARK_MAP_COLORS.residential)).toBeGreaterThan(0);
    expect(countColor(streetTile, DARK_MAP_COLORS.path)).toBeGreaterThan(0);
    expect(countColor(streetTile, DARK_MAP_COLORS.transit)).toBeGreaterThan(0);
    expect(countColor(buildingTile, DARK_MAP_COLORS.building)).toBeGreaterThan(0);
  });
});
