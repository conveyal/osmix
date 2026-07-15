import { drawToRasterTile, type Osm, type Tile } from "osmix";

import { type MapViewport, MapCamera, TILE_SIZE } from "./camera.ts";

export const MAP_BACKGROUND = [7, 17, 13] as const;
const MAX_CACHED_TILES = 64;

export interface TileImage {
  data: Uint8ClampedArray;
}

export type TileProvider = (tile: Tile) => TileImage;

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

  for (let worldTileY = firstTileY; worldTileY <= lastTileY; worldTileY++) {
    if (worldTileY < 0 || worldTileY >= tileCount) continue;
    for (let worldTileX = firstTileX; worldTileX <= lastTileX; worldTileX++) {
      const tileX = modulo(worldTileX, tileCount);
      const tile = getTile([tileX, worldTileY, camera.zoom]);
      const screenLeft = worldTileX * TILE_SIZE - origin.x;
      const screenTop = worldTileY * TILE_SIZE - origin.y;
      const startX = Math.max(0, screenLeft);
      const endX = Math.min(width, screenLeft + TILE_SIZE);
      const startY = Math.max(0, screenTop);
      const endY = Math.min(height, screenTop + TILE_SIZE);

      for (let screenY = startY; screenY < endY; screenY++) {
        const sourceY = screenY - screenTop;
        for (let screenX = startX; screenX < endX; screenX++) {
          const sourceX = screenX - screenLeft;
          const sourceOffset = (sourceY * TILE_SIZE + sourceX) * 4;
          const targetOffset = (screenY * width + screenX) * 4;
          compositePixel(pixels, targetOffset, tile.data, sourceOffset);
        }
      }
    }
  }

  return pixels;
}

/** Create a bounded least-recently-used tile provider backed by osmix raster rendering. */
export function createOsmTileProvider(osm: Osm): TileProvider {
  const cache = new Map<string, TileImage>();
  return (tile) => {
    const key = tile.join("/");
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }

    const rendered = { data: drawToRasterTile(osm, tile).imageData };
    cache.set(key, rendered);
    if (cache.size > MAX_CACHED_TILES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return rendered;
  };
}
