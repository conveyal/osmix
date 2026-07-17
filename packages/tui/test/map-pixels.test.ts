import type { Tile } from "osmix";
import { describe, expect, it } from "vitest";

import { MapCamera, TILE_SIZE } from "../src/camera.ts";
import {
  formatTileLoadingStatus,
  isShimmerCell,
  MAP_BACKGROUND,
  OsmTileLoader,
  renderMapPixels,
  SHIMMER_PERIOD,
  TILE_LOADING_BASE,
} from "../src/map-pixels.ts";

function solidTile(red: number, green: number, blue: number, alpha: number) {
  const data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = alpha;
  }
  return { data };
}

function pixel(pixels: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}

function tinyTile(value: number) {
  return { data: new Uint8ClampedArray([value, value, value, 255]) };
}

async function flushTileWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("renderMapPixels", () => {
  it("composites raster alpha over the map background", () => {
    const pixels = renderMapPixels(new MapCamera(0.5, 0.5, 0), { width: 2, height: 2 }, () =>
      solidTile(207, 117, 13, 128),
    );
    expect(Array.from(pixels.slice(0, 4))).toEqual([107, 67, 13, 255]);
  });

  it("leaves transparent raster pixels at the map background", () => {
    const pixels = renderMapPixels(new MapCamera(0.5, 0.5, 0), { width: 1, height: 1 }, () =>
      solidTile(255, 255, 255, 0),
    );
    expect([...pixels]).toEqual([...MAP_BACKGROUND, 255]);
  });

  it("wraps horizontal world tiles before requesting raster data", () => {
    const requested: Tile[] = [];
    const getTile = (tile: Tile) => {
      requested.push(tile);
      return solidTile(0, 0, 0, 0);
    };
    renderMapPixels(new MapCamera(0, 0.5, 0), { width: 4, height: 1 }, getTile);
    expect(requested.length).toBeGreaterThan(0);
    for (const tile of requested) expect(tile[0]).toBe(0);
  });

  it("fills missing tiles with the map background and records their clipped regions", () => {
    const camera = new MapCamera(0.5, 0.5, 1);
    const viewport = { width: 300, height: 2 };
    const getTile = (tile: Tile) => (tile[0] === 0 ? null : solidTile(80, 90, 100, 255));
    const pendingRegions: Array<{ bottom: number; left: number; right: number; top: number }> = [];
    const pixels = renderMapPixels(camera, viewport, getTile, pendingRegions);

    expect(TILE_LOADING_BASE).toBe(MAP_BACKGROUND);
    expect(pixel(pixels, viewport.width, 24, 0)).toEqual([...TILE_LOADING_BASE, 255]);
    expect(pixel(pixels, viewport.width, 250, 0)).toEqual([80, 90, 100, 255]);
    expect(pendingRegions).toEqual([
      { bottom: 1, left: 0, right: 150, top: 0 },
      { bottom: 2, left: 0, right: 150, top: 1 },
    ]);
  });

  it("changes at most fifteen percent of pending cells between shimmer phases", () => {
    const width = SHIMMER_PERIOD * 10;
    const height = 20;
    let changed = 0;
    let highlighted = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const first = isShimmerCell(x, y, 0);
        const second = isShimmerCell(x, y, 1);
        if (first) highlighted++;
        if (first !== second) changed++;
      }
    }

    expect(highlighted / (width * height)).toBeCloseTo(1 / SHIMMER_PERIOD, 5);
    expect(changed / (width * height)).toBeLessThanOrEqual(0.15);
  });
});

describe("OsmTileLoader", () => {
  it("self-starts cache misses and exposes completed tiles progressively", async () => {
    const rendered: string[] = [];
    const resolvers = new Map<string, (tile: ReturnType<typeof tinyTile>) => void>();
    const loader = new OsmTileLoader({
      renderTile: (tile, generation) => {
        const key = tile.join("/");
        rendered.push(`${key}@${generation}`);
        return new Promise((resolve) => resolvers.set(key, resolve));
      },
    });
    const first: Tile = [1, 2, 3];
    const second: Tile = [2, 2, 3];

    loader.beginFrame();
    expect(loader.getTile(first)).toBeNull();
    expect(loader.getTile(second)).toBeNull();
    loader.endFrame();
    expect(loader.pendingCount).toBe(2);

    await Promise.resolve();
    expect(rendered).toEqual(["1/2/3@1"]);
    resolvers.get("1/2/3")!(tinyTile(1));
    await flushTileWork();
    loader.beginFrame();
    expect(loader.getTile(first)?.data[0]).toBe(1);
    expect(loader.getTile(second)).toBeNull();
    loader.endFrame();
    expect(loader.pendingCount).toBe(1);
    expect(rendered).toEqual(["1/2/3@1", "2/2/3@1"]);
    resolvers.get("2/2/3")!(tinyTile(2));
    await flushTileWork();
  });

  it("drops queued work that is not requested by the latest viewport", async () => {
    const rendered: string[] = [];
    let resolveBlocker!: (tile: ReturnType<typeof tinyTile>) => void;
    const loader = new OsmTileLoader({
      renderTile: (tile) => {
        rendered.push(tile.join("/"));
        if (tile[0] === 0) return new Promise((resolve) => (resolveBlocker = resolve));
        return tinyTile(1);
      },
    });

    loader.beginFrame();
    loader.getTile([0, 0, 5]);
    loader.getTile([1, 1, 5]);
    loader.getTile([2, 2, 5]);
    loader.endFrame();
    await Promise.resolve();
    expect(rendered).toEqual(["0/0/5"]);

    loader.beginFrame();
    loader.getTile([8, 8, 5]);
    loader.endFrame();

    expect(loader.pendingCount).toBe(1);
    resolveBlocker(tinyTile(0));
    await flushTileWork();
    expect(rendered).toEqual(["0/0/5", "8/8/5"]);
  });

  it("starts center-most viewport tiles first", async () => {
    const started: Array<{ generation: number; tile: Tile }> = [];
    const loader = new OsmTileLoader({
      renderTile: (tile, generation) => {
        started.push({ generation, tile });
        return new Promise(() => undefined);
      },
    });
    const camera = new MapCamera(2.25 / 8, 2.25 / 8, 3);

    loader.beginFrame(42);
    renderMapPixels(camera, { width: 400, height: 400 }, loader.getTile);
    loader.endFrame();
    await Promise.resolve();

    expect(started).toEqual([{ generation: 42, tile: [2, 2, 3] }]);
    loader.dispose();
  });

  it("reorders overlapping queued tiles for the latest viewport", async () => {
    const started: number[] = [];
    let releaseBlocker!: (tile: ReturnType<typeof tinyTile>) => void;
    const loader = new OsmTileLoader({
      renderTile: (tile) => {
        started.push(tile[0]);
        if (tile[0] === 0) return new Promise((resolve) => (releaseBlocker = resolve));
        return new Promise(() => undefined);
      },
    });
    loader.beginFrame(1);
    loader.getTile([0, 0, 5]);
    loader.getTile([1, 0, 5]);
    loader.getTile([2, 0, 5]);
    loader.endFrame();
    await Promise.resolve();

    loader.beginFrame(2);
    loader.getTile([2, 0, 5]);
    loader.getTile([1, 0, 5]);
    loader.endFrame();
    releaseBlocker(tinyTile(0));
    await flushTileWork();

    expect(started).toEqual([0, 2]);
    loader.dispose();
  });

  it("keeps the default cache bounded to 64 least-recently-used tiles", async () => {
    const loader = new OsmTileLoader({
      renderTile: (tile) => tinyTile(tile[0]),
    });
    for (let index = 0; index < 65; index++) {
      loader.beginFrame();
      loader.getTile([index, 0, 8]);
      loader.endFrame();
      await flushTileWork();
    }

    expect(loader.cacheSize).toBe(64);
    loader.beginFrame();
    expect(loader.getTile([0, 0, 8])).toBeNull();
    expect(loader.getTile([64, 0, 8])?.data[0]).toBe(64);
    loader.endFrame();
    loader.dispose();
  });

  it("renders concurrently and refills slots as jobs finish out of order", async () => {
    const resolvers = new Map<number, (tile: ReturnType<typeof tinyTile>) => void>();
    const started: number[] = [];
    const loader = new OsmTileLoader({
      maxConcurrentTiles: 2,
      renderTile: (tile) => {
        started.push(tile[0]);
        return new Promise((resolve) => resolvers.set(tile[0], resolve));
      },
    });
    loader.beginFrame();
    loader.getTile([1, 0, 8]);
    loader.getTile([2, 0, 8]);
    loader.getTile([3, 0, 8]);
    loader.endFrame();

    await Promise.resolve();
    expect(started).toEqual([1, 2]);
    resolvers.get(2)!(tinyTile(2));
    await flushTileWork();
    expect(started).toEqual([1, 2, 3]);
    expect(loader.pendingCount).toBe(2);

    resolvers.get(3)!(tinyTile(3));
    resolvers.get(1)!(tinyTile(1));
    await flushTileWork();
    expect(loader.pendingCount).toBe(0);
  });

  it("does not redraw stale completions but reuses their cached result", async () => {
    let resolveOld!: (tile: ReturnType<typeof tinyTile>) => void;
    let completions = 0;
    const loader = new OsmTileLoader({
      onTileComplete: () => completions++,
      renderTile: () => new Promise((resolve) => (resolveOld = resolve)),
    });
    const oldTile: Tile = [1, 1, 8];
    loader.beginFrame();
    loader.getTile(oldTile);
    loader.endFrame();
    await Promise.resolve();

    loader.beginFrame();
    loader.getTile([2, 2, 8]);
    loader.endFrame();
    resolveOld(tinyTile(1));
    await flushTileWork();

    expect(completions).toBe(0);
    loader.beginFrame();
    expect(loader.getTile(oldTile)?.data[0]).toBe(1);
    loader.endFrame();
    loader.dispose();
  });

  it("stops work after disposal and propagates rendering errors", async () => {
    const disposed = new OsmTileLoader({ renderTile: () => tinyTile(1) });
    disposed.beginFrame();
    disposed.getTile([1, 1, 1]);
    disposed.endFrame();
    disposed.dispose();
    expect(disposed.pendingCount).toBe(0);
    expect(disposed.processPending()).toBe(0);
    expect(disposed.getTile([1, 1, 1])).toBeNull();
    expect(disposed.pendingCount).toBe(0);

    let failure: unknown;
    const failing = new OsmTileLoader({
      onError: (error) => (failure = error),
      renderTile: () => {
        throw Error("tile failed");
      },
    });
    failing.beginFrame();
    failing.getTile([1, 1, 1]);
    failing.endFrame();
    await flushTileWork();
    expect(failing.pendingCount).toBe(0);
    expect(failure).toEqual(Error("tile failed"));
  });
});

describe("tile loading status", () => {
  it("formats singular and plural pending counts", () => {
    expect(formatTileLoadingStatus(1, "⠋")).toBe("⠋ Rendering 1 tile…");
    expect(formatTileLoadingStatus(3, "⠙")).toBe("⠙ Rendering 3 tiles…");
  });
});
