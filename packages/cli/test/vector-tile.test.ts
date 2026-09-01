import { pointToTileFraction } from "@osmix/geo/tile";
import { Osm, OsmixRasterTile, type Tile, type XY } from "osmix";
import { describe, expect, it } from "vitest";

import { buildVectorTile, buildVectorTileAsync } from "../src/vector-tile.ts";

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

function build(osm: Osm, tile: Tile) {
  osm.buildIndexes();
  osm.buildSpatialIndexes();
  return buildVectorTile(osm, tile, undefined, {});
}

describe("buildVectorTile", () => {
  it("clips filled polygons and rejects cancelled work", () => {
    const tileIndex = tileAt(0, 0, 14);
    const projector = new OsmixRasterTile({ tile: tileIndex, tileSize: 256 });
    const osm = new Osm();
    addWayAtPixels(
      osm,
      projector,
      1,
      [
        [-40, 20],
        [280, 20],
        [280, 220],
        [-40, 220],
        [-40, 20],
      ],
      { natural: "water" },
    );

    const packet = build(osm, tileIndex);
    expect(packet?.groups.length).toBeGreaterThan(0);
    expect(packet?.groups[0]).toMatchObject({ category: "way", sourceEntityIds: [1] });
    const positions = new Float32Array(packet!.groups[0]!.positions);
    expect(Math.min(...positions.filter((_, index) => index % 3 === 0))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...positions.filter((_, index) => index % 3 === 0))).toBeLessThanOrEqual(256);
    expect(buildVectorTile(osm, tileIndex, undefined, {}, () => true)).toBeNull();
  });

  it("expands cased roads and emits point-symbol triangles", () => {
    const tileIndex = tileAt(0, 0, 14);
    const projector = new OsmixRasterTile({ tile: tileIndex, tileSize: 256 });
    const osm = new Osm();
    addWayAtPixels(
      osm,
      projector,
      2,
      [
        [8, 128],
        [128, 64],
        [248, 128],
      ],
      { highway: "primary" },
    );
    const [lon, lat] = projector.tilePxToLonLat([128, 96]);
    osm.nodes.addNode({ id: 999, lon, lat, tags: { amenity: "hospital" } });

    const packet = build(osm, tileIndex);
    expect(packet?.groups.length).toBeGreaterThanOrEqual(3);
    expect(packet?.groups.every((group) => group.indices.byteLength > 0)).toBe(true);
    expect(packet?.groups.some((group) => group.order < (packet.groups.at(-1)?.order ?? 0))).toBe(
      true,
    );
    const roadGroups = packet!.groups.filter((group) => group.sourceEntityIds.includes(2));
    expect(roadGroups.length).toBe(2);
    expect(roadGroups.every((group) => new Uint32Array(group.indices).length >= 84)).toBe(true);
  });

  it("rejects zero-length lines instead of emitting empty stroke groups", () => {
    const tileIndex = tileAt(0, 0, 14);
    const projector = new OsmixRasterTile({ tile: tileIndex, tileSize: 256 });
    const osm = new Osm();
    addWayAtPixels(
      osm,
      projector,
      3,
      [
        [128, 128],
        [128, 128],
      ],
      { highway: "primary" },
    );
    addWayAtPixels(
      osm,
      projector,
      4,
      [
        [64, 64],
        [192, 64],
      ],
      { highway: "primary" },
    );

    const packet = build(osm, tileIndex);
    expect(packet?.groups.some((group) => group.sourceEntityIds.includes(4))).toBe(true);
    expect(packet?.groups.some((group) => group.sourceEntityIds.includes(3))).toBe(false);
  });

  it("preserves synchronous packets while yielding geometry construction in chunks", async () => {
    const tileIndex = tileAt(0, 0, 14);
    const projector = new OsmixRasterTile({ tile: tileIndex, tileSize: 256 });
    const osm = new Osm();
    addWayAtPixels(
      osm,
      projector,
      5,
      [
        [8, 128],
        [128, 32],
        [248, 128],
      ],
      { highway: "primary" },
    );
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    let yields = 0;

    const synchronous = buildVectorTile(osm, tileIndex, undefined, {});
    const cooperative = await buildVectorTileAsync(osm, tileIndex, undefined, {}, () => false, {
      chunkBudgetMs: 0,
      yieldToEventLoop: () => {
        yields++;
        return Promise.resolve();
      },
    });

    expect(yields).toBeGreaterThan(0);
    expect(cooperative).toEqual(synchronous);
  });

  it("yields a macrotask so message cancellation can stop vector construction", async () => {
    const tileIndex = tileAt(0, 0, 14);
    const projector = new OsmixRasterTile({ tile: tileIndex, tileSize: 256 });
    const osm = new Osm();
    for (let index = 0; index < 500; index++) {
      addWayAtPixels(
        osm,
        projector,
        1_000 + index,
        [
          [4, 1 + (index % 254)],
          [252, 1 + (index % 254)],
        ],
        { highway: "primary" },
      );
    }
    osm.buildIndexes();
    osm.buildSpatialIndexes();
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 0);

    const packet = await buildVectorTileAsync(osm, tileIndex, undefined, {}, () => cancelled, {
      chunkBudgetMs: 0,
    });

    expect(cancelled).toBe(true);
    expect(packet).toBeNull();
  });
});
