/**
 * Nearest-neighbor search over a geographic Flatbush index.
 *
 * A typed port of `around` from `geoflatbush` 2.2.1 (ISC, Vladimir Agafonkin); see
 * `THIRD_PARTY_NOTICES.md`. It reads Flatbush's internal tree arrays, so it must stay in step
 * with the installed `flatbush` version.
 *
 * @module
 */

import type Flatbush from "flatbush";

const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;

/**
 * Return item indexes of a Flatbush index in order of great-circle distance from a point.
 * Assumes the index holds `[minLng, minLat, maxLng, maxLat]` boxes in degrees.
 *
 * @param index - Flatbush index of geographic boxes.
 * @param lng - Query longitude in degrees.
 * @param lat - Query latitude in degrees.
 * @param maxResults - Maximum number of items to return.
 * @param maxDistance - Maximum distance in kilometers.
 * @param filterFn - Optional filter called with each candidate item index.
 */
export function flatbushAround(
  index: Flatbush,
  lng: number,
  lat: number,
  maxResults = Infinity,
  maxDistance = Infinity,
  filterFn?: (index: number) => boolean,
): number[] {
  const result: number[] = [];

  const cosLat = Math.cos(lat * RAD);
  const sinLat = Math.sin(lat * RAD);

  // We order the priority queue by negative cosine of angular distance (smaller = closer),
  // avoiding a Math.acos per box. Convert maxDistance to its equivalent threshold once.
  const negCosMaxDist =
    maxDistance === Infinity ? Infinity : -Math.cos(maxDistance / EARTH_RADIUS_KM);

  const { _boxes: boxes, _indices: indices, _queue: q, _levelBounds: levelBounds } = index;
  const nodeSize4 = index.nodeSize * 4;
  const numItems4 = index.numItems * 4;

  // Tree nodes and leaves share the queue; encode leaves with LSB = 1 so we can tell them
  // apart with `& 1`. Seed with the root node — any priority works since the queue is empty.
  q.push((boxes.length - 4) << 1, 0);

  while (q.length) {
    const top = q.ids[0]!;
    // if the closest queued entry is a leaf, it's the next result in distance order
    if (top & 1) {
      if (q.values[0]! > negCosMaxDist) break;
      q.pop();
      result.push(top >> 1);
      if (result.length === maxResults) break;
      continue;
    }

    q.pop();
    const nodeIndex = top >> 1;
    const isLeafLevel = nodeIndex < numItems4;
    const end = Math.min(nodeIndex + nodeSize4, upperBound(nodeIndex, levelBounds));

    for (let pos = nodeIndex; pos < end; pos += 4) {
      const childIndex = indices[pos >> 2]! | 0;
      const negCosDist = boxNegCosDist(
        lng,
        lat,
        boxes[pos]!,
        boxes[pos + 1]!,
        boxes[pos + 2]!,
        boxes[pos + 3]!,
        cosLat,
        sinLat,
      );

      if (isLeafLevel) {
        if (!filterFn || filterFn(childIndex)) q.push((childIndex << 1) | 1, negCosDist);
      } else {
        q.push(childIndex << 1, negCosDist);
      }
    }
  }

  q.clear();
  return result;
}

/** Binary search for the first value in the array bigger than the given one. */
function upperBound(value: number, arr: number[]): number {
  let i = 0;
  let j = arr.length - 1;
  while (i < j) {
    const m = (i + j) >> 1;
    if (arr[m]! > value) {
      j = m;
    } else {
      i = m + 1;
    }
  }
  return arr[i]!;
}

/**
 * Lower bound for distance from a location to points inside a bounding box,
 * expressed as the negative cosine of the angular distance (monotonic with real distance,
 * but avoids a Math.acos call on every comparison).
 */
function boxNegCosDist(
  lng: number,
  lat: number,
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  cosLat: number,
  sinLat: number,
): number {
  // query point is between minimum and maximum longitudes
  if (lng >= minLng && lng <= maxLng) {
    if (lat < minLat) return -Math.cos((minLat - lat) * RAD); // south
    if (lat > maxLat) return -Math.cos((lat - maxLat) * RAD); // north
    return -1; // inside the bbox
  }

  // query point is west or east of the bounding box;
  // calculate the extremum for great circle distance from query point to the closest longitude
  let westGap = minLng - lng;
  if (westGap < 0) westGap += 360;
  let eastGap = lng - maxLng;
  if (eastGap < 0) eastGap += 360;
  const closestLng = westGap <= eastGap ? minLng : maxLng;
  const cosLngDelta = Math.cos((closestLng - lng) * RAD);

  // bigger d = closer; take the max of candidate cosines as the lower bound on distance
  const dMin = cosAngular(minLat, cosLat, sinLat, cosLngDelta);
  if (minLat === maxLat) return -dMin; // point item — skip second corner and extremum check
  let d = Math.max(dMin, cosAngular(maxLat, cosLat, sinLat, cosLngDelta));

  const extremumLat = Math.atan(sinLat / (cosLat * cosLngDelta)) / RAD;
  if (extremumLat > minLat && extremumLat < maxLat) {
    d = Math.max(d, cosAngular(extremumLat, cosLat, sinLat, cosLngDelta));
  }

  return -d;
}

/** Cosine of angular distance between the query point and (any lng with cosLngDelta, lat). */
function cosAngular(lat: number, cosLat: number, sinLat: number, cosLngDelta: number): number {
  const d = sinLat * Math.sin(lat * RAD) + cosLat * Math.cos(lat * RAD) * cosLngDelta;
  return d < 1 ? d : 1;
}
