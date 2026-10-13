/**
 * GeoJSON polygon winding.
 *
 * Rewinds polygon rings to the RFC 7946 order: outer rings counterclockwise,
 * holes clockwise. Adapted from `@placemarkio/geojson-rewind` 1.0.3 (MIT); see
 * `THIRD_PARTY_NOTICES.md`.
 *
 * @module
 */

import type { Feature, Geometry, Position } from "geojson";

/**
 * Wind a ring clockwise or counterclockwise.
 * Returns the ring itself when it already has that winding, or a reversed copy.
 */
export function rewindRing<T extends Position>(ring: T[], clockwise: boolean): T[] {
  let area = 0;
  let err = 0;
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const k = (a[0]! - b[0]!) * (b[1]! + a[1]!);
    const m = area + k;
    err += Math.abs(area) >= Math.abs(k) ? area - m + k : k - m + area;
    area = m;
  }
  if (area + err >= 0 !== clockwise) return ring.slice().reverse();
  return ring;
}

function rewindRings(rings: Position[][]): Position[][] {
  return rings.map((ring, i) => rewindRing(ring, i !== 0));
}

/**
 * Wind the rings of polygons and multipolygons, including those inside
 * geometry collections, in the RFC 7946 order. Other geometries are returned
 * unchanged. Never mutates the input.
 */
export function rewindGeometry(geometry: Geometry): Geometry {
  switch (geometry.type) {
    case "Polygon":
      return { ...geometry, coordinates: rewindRings(geometry.coordinates) };
    case "MultiPolygon":
      return { ...geometry, coordinates: geometry.coordinates.map(rewindRings) };
    case "GeometryCollection":
      return { ...geometry, geometries: geometry.geometries.map(rewindGeometry) };
    default:
      return geometry;
  }
}

/**
 * Wind the rings of a feature's polygon geometry in the RFC 7946 order.
 * Returns the feature itself when it has no geometry. Never mutates the input.
 */
export function rewindFeature<P>(
  feature: Feature<Geometry | null, P>,
): Feature<Geometry | null, P> {
  if (!feature.geometry) return feature;
  return { ...feature, geometry: rewindGeometry(feature.geometry) };
}
