import type { GeoBbox2D } from "@osmix/shared/types";

/** Initial map viewport around default merge basemap (Yakima area). */
export const DEFAULT_EXTRACT_BBOX: GeoBbox2D = [-121.65, 46.45, -120.35, 47.25];

export function isValidBbox(bbox: GeoBbox2D): boolean {
  const [w, s, e, n] = bbox;
  if (![w, s, e, n].every((x) => Number.isFinite(x))) return false;
  if (w >= e || s >= n) return false;
  if (w < -180 || e > 180 || s < -90 || n > 90) return false;
  return true;
}

export function parseBboxString(raw: string): GeoBbox2D | null {
  const parts = raw.split(",").map((p) => Number.parseFloat(p.trim()));
  if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) return null;
  const candidate = parts as GeoBbox2D;
  return isValidBbox(candidate) ? candidate : null;
}

export function boundsLikeToBbox(bounds: maplibregl.LngLatBounds | null): GeoBbox2D | null {
  if (!bounds) return null;
  const [sw, ne] = bounds.toArray() as [[number, number], [number, number]];
  const [w, s] = sw;
  const [e, n] = ne;
  const bbox: GeoBbox2D = [w, s, e, n];
  return isValidBbox(bbox) ? bbox : null;
}
