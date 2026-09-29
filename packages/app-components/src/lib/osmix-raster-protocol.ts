import type { OsmixAppRemote } from "@osmix/app-core";
import { addProtocol, type GetResourceResponse, removeProtocol } from "maplibre-gl";
import type { DrawToRasterTileOptions, Rgba, Tile } from "osmix";

import { RASTER_PROTOCOL_NAME } from "../constants.ts";
import { type MapColors, readMapColors } from "../hooks/map-colors.ts";

/** `@osmix/raster://<osmId>/<tileSize>/<z>/<x>/<y>.png` with an optional `?role=base|patch`. */
export const RASTER_URL_PATTERN =
  /^@osmix\/raster:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.png(?:\?role=(base|patch))?$/;

/** Which dataset color a raster tile is drawn in (the `base` or `patch` map color). */
export type RasterColorRole = "base" | "patch";

export function osmixIdToTileUrl(osmId: string, tileSize: number, role: RasterColorRole = "base") {
  const id = encodeURIComponent(osmId);
  return `${RASTER_PROTOCOL_NAME}://${id}/${tileSize}/{z}/{x}/{y}.png?role=${role}`;
}

/** Alpha per geometry kind, matching the `@osmix/raster` defaults. */
const LINE_ALPHA = 230;
const AREA_ALPHA = 64;
const POINT_ALPHA = 255;

function rgbToRgba(rgb: string, alpha: number): Rgba {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(rgb);
  if (!match) throw new Error(`Cannot draw raster tiles: unexpected map color ${rgb}`);
  return [+match[1], +match[2], +match[3], alpha];
}

let rasterColors: Record<RasterColorRole, DrawToRasterTileOptions> | null = null;

/** Raster draw colors per role, resolved once from the `--map-*` tokens. */
function rasterColorsFor(role: RasterColorRole): DrawToRasterTileOptions {
  if (!rasterColors) {
    const colors: MapColors = readMapColors();
    const toOptions = (rgb: string): DrawToRasterTileOptions => ({
      lineColor: rgbToRgba(rgb, LINE_ALPHA),
      areaColor: rgbToRgba(rgb, AREA_ALPHA),
      pointColor: rgbToRgba(rgb, POINT_ALPHA),
    });
    rasterColors = { base: toOptions(colors.base), patch: toOptions(colors.patch) };
  }
  return rasterColors[role];
}

/**
 * Creates a MapLibre protocol action that handles requests for raster tiles.
 */
let registered = false;

export function addOsmixRasterProtocol(remote: OsmixAppRemote) {
  if (registered) return;
  addProtocol(
    RASTER_PROTOCOL_NAME,
    async (req, abortController): Promise<GetResourceResponse<ArrayBuffer>> => {
      const m = RASTER_URL_PATTERN.exec(req.url);
      if (!m) throw new Error(`Bad ${RASTER_PROTOCOL_NAME} URL: ${req.url}`);
      const [, osmId, sizeStr, zStr, xStr, yStr, role] = m;

      const tileSize = +sizeStr;
      const tileIndex: Tile = [+xStr, +yStr, +zStr];
      const id = decodeURIComponent(osmId);
      const rasterTile = await remote.runWithWorker(
        (worker) =>
          worker.getRasterTile(id, tileIndex, {
            tileSize,
            ...rasterColorsFor((role as RasterColorRole | undefined) ?? "base"),
          }),
        {
          lane: "compute",
          retry: "once",
          signal: abortController.signal,
        },
      );
      const data = await rasterTileToImageBuffer(rasterTile, tileSize);
      return {
        data,
        cacheControl: "no-store",
      };
    },
  );
  registered = true;
}

export function removeOsmixRasterProtocol() {
  if (!registered) return;
  removeProtocol(RASTER_PROTOCOL_NAME);
  registered = false;
}

/**
 * Converts an RGBA array to an image buffer using the OffscreenCanvas API.
 * This is the standard browser-native approach and requires no external dependencies.
 */
export async function rasterTileToImageBuffer(
  imageData: Uint8ClampedArray<ArrayBuffer>,
  tileSize: number,
  options: ImageEncodeOptions = { type: "image/png" },
) {
  const canvas = new OffscreenCanvas(tileSize, tileSize);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context from OffscreenCanvas");
  ctx.putImageData(new ImageData(imageData, tileSize, tileSize), 0, 0);
  const blob = await canvas.convertToBlob(options);
  return await blob.arrayBuffer();
}
