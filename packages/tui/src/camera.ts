import type { GeoBbox2D, LonLat } from "osmix";

export const TILE_SIZE = 256;
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 20;

const MAX_MERCATOR_LATITUDE = 85.051_128_78;
const FIT_PADDING = 0.9;

export interface MapViewport {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrap(value: number): number {
  return ((value % 1) + 1) % 1;
}

export function lonLatToWorld([lon, lat]: LonLat): ScreenPoint {
  const limitedLat = clamp(lat, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const radians = (limitedLat * Math.PI) / 180;
  return {
    x: wrap((lon + 180) / 360),
    y: clamp((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2, 0, 1),
  };
}

export function worldToLonLat({ x, y }: ScreenPoint): LonLat {
  const lon = wrap(x) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * clamp(y, 0, 1)))) * 180) / Math.PI;
  return [lon, lat];
}

/** Integer-zoom Web Mercator camera for a terminal-sized pixel viewport. */
export class MapCamera {
  centerX: number;
  centerY: number;
  zoom: number;

  constructor(centerX = 0.5, centerY = 0.5, zoom = MIN_ZOOM) {
    this.centerX = wrap(centerX);
    this.centerY = clamp(centerY, 0, 1);
    this.zoom = clamp(Math.round(zoom), MIN_ZOOM, MAX_ZOOM);
  }

  static fitBounds(bounds: GeoBbox2D, viewport: MapViewport): MapCamera {
    const northwest = lonLatToWorld([bounds[0], bounds[3]]);
    const southeast = lonLatToWorld([bounds[2], bounds[1]]);
    const width = Math.max(0, southeast.x - northwest.x);
    const height = Math.max(0, southeast.y - northwest.y);
    const availableWidth = Math.max(1, viewport.width) * FIT_PADDING;
    const availableHeight = Math.max(1, viewport.height) * FIT_PADDING;
    const xScale = width === 0 ? Number.POSITIVE_INFINITY : availableWidth / (width * TILE_SIZE);
    const yScale = height === 0 ? Number.POSITIVE_INFINITY : availableHeight / (height * TILE_SIZE);
    const scale = Math.min(xScale, yScale);
    const zoom = Number.isFinite(scale)
      ? clamp(Math.floor(Math.log2(scale)), MIN_ZOOM, MAX_ZOOM)
      : MAX_ZOOM;
    return new MapCamera(
      wrap(northwest.x + width / 2),
      clamp(northwest.y + height / 2, 0, 1),
      zoom,
    );
  }

  get center(): LonLat {
    return worldToLonLat({ x: this.centerX, y: this.centerY });
  }

  get worldSize(): number {
    return TILE_SIZE * 2 ** this.zoom;
  }

  origin(viewport: MapViewport): ScreenPoint {
    return {
      x: Math.round(this.centerX * this.worldSize - viewport.width / 2),
      y: Math.round(this.centerY * this.worldSize - viewport.height / 2),
    };
  }

  panPixels(deltaX: number, deltaY: number): void {
    this.centerX = wrap(this.centerX + deltaX / this.worldSize);
    this.centerY = clamp(this.centerY + deltaY / this.worldSize, 0, 1);
  }

  zoomBy(delta: number, viewport: MapViewport, anchor?: ScreenPoint): void {
    const nextZoom = clamp(this.zoom + Math.sign(delta), MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === this.zoom) return;
    const point = anchor ?? { x: viewport.width / 2, y: viewport.height / 2 };
    const oldOrigin = this.origin(viewport);
    const anchoredX = (oldOrigin.x + point.x) / this.worldSize;
    const anchoredY = (oldOrigin.y + point.y) / this.worldSize;
    this.zoom = nextZoom;
    this.centerX = wrap(anchoredX + (viewport.width / 2 - point.x) / this.worldSize);
    this.centerY = clamp(anchoredY + (viewport.height / 2 - point.y) / this.worldSize, 0, 1);
  }
}
