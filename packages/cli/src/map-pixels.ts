import type { Tile } from "osmix";

import { type MapViewport, MapCamera, TILE_SIZE } from "./camera.ts";

export const MAP_BACKGROUND = [7, 17, 13] as const;
const MAX_CACHED_TILES = 64;
export const TILE_LOADING_BASE = MAP_BACKGROUND;
export const TILE_LOADING_HIGHLIGHT = [26, 73, 53] as const;
export const SHIMMER_PERIOD = 24;

export interface TileImage {
  data: Uint8ClampedArray;
}

export interface PendingTileRegion {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export type TileProvider = (tile: Tile) => TileImage | null;
export type TileRenderer = (
  tile: Tile,
  generation: number,
) => TileImage | null | Promise<TileImage | null>;

export function formatTileLoadingStatus(pendingCount: number, spinner: string): string {
  return `${spinner} Rendering ${pendingCount} ${pendingCount === 1 ? "tile" : "tiles"}…`;
}

interface PendingTile {
  generation: number;
  tile: Tile;
}

interface OsmTileLoaderOptions {
  maxCachedTiles?: number;
  maxConcurrentTiles?: number;
  onError?: (error: unknown) => void;
  onGenerationChange?: (generation: number) => void;
  onPendingChange?: (pendingCount: number) => void;
  onTileComplete?: () => void;
  renderTile: TileRenderer;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function fillBackground(pixels: Uint8ClampedArray): void {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = MAP_BACKGROUND[0];
    pixels[offset + 1] = MAP_BACKGROUND[1];
    pixels[offset + 2] = MAP_BACKGROUND[2];
    pixels[offset + 3] = 255;
  }
}

function fillLoadingPixel(pixels: Uint8ClampedArray, offset: number): void {
  pixels[offset] = TILE_LOADING_BASE[0];
  pixels[offset + 1] = TILE_LOADING_BASE[1];
  pixels[offset + 2] = TILE_LOADING_BASE[2];
  pixels[offset + 3] = 255;
}

/** Return whether a terminal cell is the sparse highlight for this animation phase. */
export function isShimmerCell(x: number, y: number, phase: number): boolean {
  return modulo(x + y * 2 - phase, SHIMMER_PERIOD) === 0;
}

function compositePixel(
  target: Uint8ClampedArray,
  targetOffset: number,
  source: Uint8ClampedArray,
  sourceOffset: number,
): void {
  const alpha = source[sourceOffset + 3]! / 255;
  if (alpha === 0) return;
  const inverseAlpha = 1 - alpha;
  target[targetOffset] = Math.round(
    source[sourceOffset]! * alpha + MAP_BACKGROUND[0] * inverseAlpha,
  );
  target[targetOffset + 1] = Math.round(
    source[sourceOffset + 1]! * alpha + MAP_BACKGROUND[1] * inverseAlpha,
  );
  target[targetOffset + 2] = Math.round(
    source[sourceOffset + 2]! * alpha + MAP_BACKGROUND[2] * inverseAlpha,
  );
}

/** Compose cached XYZ raster tiles into the current terminal map viewport. */
export function renderMapPixels(
  camera: MapCamera,
  viewport: MapViewport,
  getTile: TileProvider,
  pendingRegions?: PendingTileRegion[],
): Uint8ClampedArray {
  const width = Math.max(0, Math.floor(viewport.width));
  const height = Math.max(0, Math.floor(viewport.height));
  const pixels = new Uint8ClampedArray(width * height * 4);
  fillBackground(pixels);
  if (width === 0 || height === 0) return pixels;

  const origin = camera.origin({ width, height });
  const firstTileX = Math.floor(origin.x / TILE_SIZE);
  const lastTileX = Math.floor((origin.x + width - 1) / TILE_SIZE);
  const firstTileY = Math.floor(origin.y / TILE_SIZE);
  const lastTileY = Math.floor((origin.y + height - 1) / TILE_SIZE);
  const tileCount = 2 ** camera.zoom;

  const visibleTiles: Array<{
    distance: number;
    screenLeft: number;
    screenTop: number;
    tile: Tile;
  }> = [];
  for (let worldTileY = firstTileY; worldTileY <= lastTileY; worldTileY++) {
    if (worldTileY < 0 || worldTileY >= tileCount) continue;
    for (let worldTileX = firstTileX; worldTileX <= lastTileX; worldTileX++) {
      const tileX = modulo(worldTileX, tileCount);
      const screenLeft = worldTileX * TILE_SIZE - origin.x;
      const screenTop = worldTileY * TILE_SIZE - origin.y;
      const centerX = screenLeft + TILE_SIZE / 2 - width / 2;
      const centerY = screenTop + TILE_SIZE / 2 - height / 2;
      visibleTiles.push({
        distance: centerX * centerX + centerY * centerY,
        screenLeft,
        screenTop,
        tile: [tileX, worldTileY, camera.zoom],
      });
    }
  }
  visibleTiles.sort((a, b) => a.distance - b.distance);

  for (const visible of visibleTiles) {
    const { screenLeft, screenTop } = visible;
    const tile = getTile(visible.tile);
    const startX = Math.max(0, screenLeft);
    const endX = Math.min(width, screenLeft + TILE_SIZE);
    const startY = Math.max(0, screenTop);
    const endY = Math.min(height, screenTop + TILE_SIZE);
    if (!tile) pendingRegions?.push({ left: startX, top: startY, right: endX, bottom: endY });

    for (let screenY = startY; screenY < endY; screenY++) {
      const sourceY = screenY - screenTop;
      for (let screenX = startX; screenX < endX; screenX++) {
        const targetOffset = (screenY * width + screenX) * 4;
        if (!tile) {
          fillLoadingPixel(pixels, targetOffset);
          continue;
        }
        const sourceX = screenX - screenLeft;
        const sourceOffset = (sourceY * TILE_SIZE + sourceX) * 4;
        compositePixel(pixels, targetOffset, tile.data, sourceOffset);
      }
    }
  }

  return pixels;
}

/** Queue cache misses while serving completed tiles from a bounded LRU cache. */
export class OsmTileLoader {
  readonly getTile: TileProvider;
  private readonly cache = new Map<string, TileImage>();
  private readonly inFlight = new Map<string, PendingTile>();
  private readonly maxCachedTiles: number;
  private readonly maxConcurrentTiles: number;
  private readonly onError: (error: unknown) => void;
  private readonly onGenerationChange: (generation: number) => void;
  private readonly onPendingChange: (pendingCount: number) => void;
  private readonly onTileComplete: () => void;
  private readonly pending = new Map<string, PendingTile>();
  private readonly renderTile: TileRenderer;
  private disposed = false;
  private failed = false;
  private generation = 0;

  constructor(options: OsmTileLoaderOptions) {
    this.maxCachedTiles = options.maxCachedTiles ?? MAX_CACHED_TILES;
    this.maxConcurrentTiles = Math.max(1, options.maxConcurrentTiles ?? 1);
    this.onError = options.onError ?? (() => undefined);
    this.onGenerationChange = options.onGenerationChange ?? (() => undefined);
    this.onPendingChange = options.onPendingChange ?? (() => undefined);
    this.onTileComplete = options.onTileComplete ?? (() => undefined);
    this.renderTile = options.renderTile;
    this.getTile = (tile) => this.requestTile(tile);
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  get pendingCount(): number {
    if (this.failed) return 0;
    let count = 0;
    for (const pending of this.pending.values()) {
      if (pending.generation === this.generation) count++;
    }
    for (const pending of this.inFlight.values()) {
      if (pending.generation === this.generation) count++;
    }
    return count;
  }

  beginFrame(generation?: number): void {
    if (this.disposed) return;
    const nextGeneration = generation ?? this.generation + 1;
    if (nextGeneration === this.generation) return;
    this.generation = nextGeneration;
    this.onGenerationChange(nextGeneration);
  }

  endFrame(): void {
    if (this.disposed) return;
    for (const [key, pending] of this.pending) {
      if (pending.generation !== this.generation) this.pending.delete(key);
    }
    this.processPending();
    this.onPendingChange(this.pendingCount);
  }

  processPending(): number {
    if (this.disposed || this.failed) return 0;
    let started = 0;
    while (this.inFlight.size < this.maxConcurrentTiles) {
      const next = this.pending.entries().next().value as [string, PendingTile] | undefined;
      if (!next) break;
      const [key, pending] = next;
      this.pending.delete(key);
      if (pending.generation !== this.generation) continue;
      this.inFlight.set(key, pending);
      started++;
      void Promise.resolve()
        .then(() => this.renderTile(pending.tile, pending.generation))
        .then((rendered) => this.completeTile(key, pending, rendered))
        .catch((error: unknown) => this.fail(error));
    }
    return started;
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
    this.inFlight.clear();
    this.cache.clear();
    this.onPendingChange(0);
  }

  private completeTile(key: string, pending: PendingTile, rendered: TileImage | null): void {
    if (this.disposed || this.failed) return;
    this.inFlight.delete(key);
    if (!rendered) {
      if (pending.generation === this.generation) this.pending.set(key, pending);
      this.processPending();
      this.onPendingChange(this.pendingCount);
      return;
    }
    this.cache.set(key, rendered);
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    const isCurrent = pending.generation === this.generation;
    this.processPending();
    this.onPendingChange(this.pendingCount);
    if (isCurrent) this.onTileComplete();
  }

  private fail(error: unknown): void {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.pending.clear();
    this.inFlight.clear();
    this.onPendingChange(0);
    this.onError(error);
  }

  private requestTile(tile: Tile): TileImage | null {
    if (this.disposed) return null;
    const key = tile.join("/");
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    const queued = this.pending.get(key);
    if (queued) {
      queued.generation = this.generation;
      this.pending.delete(key);
      this.pending.set(key, queued);
      return null;
    }
    const rendering = this.inFlight.get(key);
    if (rendering) rendering.generation = this.generation;
    else this.pending.set(key, { generation: this.generation, tile });
    return null;
  }
}
