/** Line measurements in meters on lon/lat coordinates, for matching and replacement. */
import { haversineDistance } from "@osmix/geo/haversine-distance";
import type { LonLat } from "@osmix/types";

/** Spacing of the points `sampleLine` checks along a line. */
const SAMPLE_INTERVAL_METERS = 5;

export function lineLength(coordinates: readonly LonLat[]) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index++) {
    total += haversineDistance(coordinates[index - 1]!, coordinates[index]!);
  }
  return total;
}

function interpolate(a: LonLat, b: LonLat, parameter: number): LonLat {
  return [a[0] + (b[0] - a[0]) * parameter, a[1] + (b[1] - a[1]) * parameter];
}

export function sampleLine(coordinates: readonly LonLat[]) {
  if (coordinates.length <= 1) return [...coordinates];
  const result: LonLat[] = [coordinates[0]!];
  for (let index = 1; index < coordinates.length; index++) {
    const start = coordinates[index - 1]!;
    const end = coordinates[index]!;
    const length = haversineDistance(start, end);
    const samples = Math.floor(length / SAMPLE_INTERVAL_METERS);
    for (let sample = 1; sample <= samples; sample++) {
      const distance = sample * SAMPLE_INTERVAL_METERS;
      if (distance >= length) break;
      result.push(interpolate(start, end, distance / length));
    }
    result.push(end);
  }
  return result;
}

function pointSegmentDistance(point: LonLat, start: LonLat, end: LonLat) {
  const latitudeRadians = (point[1] * Math.PI) / 180;
  const xScale = 111_320 * Math.cos(latitudeRadians);
  const yScale = 110_574;
  const startX = (start[0] - point[0]) * xScale;
  const startY = (start[1] - point[1]) * yScale;
  const endX = (end[0] - point[0]) * xScale;
  const endY = (end[1] - point[1]) * yScale;
  const dx = endX - startX;
  const dy = endY - startY;
  const denominator = dx * dx + dy * dy;
  const parameter =
    denominator === 0 ? 0 : Math.max(0, Math.min(1, -(startX * dx + startY * dy) / denominator));
  return Math.hypot(startX + parameter * dx, startY + parameter * dy);
}

export function pointLineDistance(point: LonLat, line: readonly LonLat[]) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index++) {
    minimum = Math.min(minimum, pointSegmentDistance(point, line[index - 1]!, line[index]!));
  }
  return minimum;
}

export function symmetricLineDistance(a: readonly LonLat[], b: readonly LonLat[]) {
  let maximum = 0;
  for (const point of sampleLine(a)) maximum = Math.max(maximum, pointLineDistance(point, b));
  for (const point of sampleLine(b)) maximum = Math.max(maximum, pointLineDistance(point, a));
  return maximum;
}

export function lineBbox(
  coordinates: readonly LonLat[],
  paddingMeters: number,
): [number, number, number, number] {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of coordinates) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  const middleLat = (minLat + maxLat) / 2;
  const latPadding = paddingMeters / 110_574;
  const lonPadding =
    paddingMeters / (111_320 * Math.max(0.01, Math.cos((middleLat * Math.PI) / 180)));
  return [minLon - lonPadding, minLat - latPadding, maxLon + lonPadding, maxLat + latPadding];
}

/** Spacing of the points `tracedLengthThrough` checks: fine, so a short divergence is seen. */
const TRACE_STEP_METERS = 1;

/**
 * How far `line` stays within `tolerance` meters of `other` through its vertex `vertexIndex`:
 * the length of the unbroken stretch around the vertex, walking both ways until a point falls
 * outside. 0 when the vertex itself is outside. Stops counting at `enough`.
 */
export function tracedLengthThrough(
  line: readonly LonLat[],
  vertexIndex: number,
  other: readonly LonLat[],
  tolerance: number,
  enough = Number.POSITIVE_INFINITY,
) {
  const vertex = line[vertexIndex];
  if (!vertex || pointLineDistance(vertex, other) > tolerance) return 0;
  let total = 0;
  for (const step of [1, -1]) {
    for (let index = vertexIndex; index + step >= 0 && index + step < line.length; index += step) {
      const start = line[index]!;
      const end = line[index + step]!;
      const length = haversineDistance(start, end);
      const steps = Math.max(1, Math.ceil(length / TRACE_STEP_METERS));
      let inside = steps;
      for (let sample = 1; sample <= steps; sample++) {
        if (pointLineDistance(interpolate(start, end, sample / steps), other) > tolerance) {
          inside = sample - 1;
          break;
        }
      }
      total += (length * inside) / steps;
      if (inside < steps || total >= enough) break;
    }
    if (total >= enough) break;
  }
  return total;
}
