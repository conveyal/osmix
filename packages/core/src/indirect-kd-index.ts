/**
 * A compact static KD index over coordinate columns owned by another object.
 *
 * The selection and traversal algorithms are adapted from KDBush 4.1.0,
 * Copyright (c) 2018 Vladimir Agafonkin, distributed under the ISC License.
 * Unlike KDBush, this index stores only a Uint32 permutation. Coordinates are
 * dereferenced from the existing Int32 microdegree columns.
 */

import type { BufferType } from "./typed-arrays.ts";
import { BufferConstructor } from "./typed-arrays.ts";

const DEFAULT_NODE_SIZE = 64;

export class IndirectKdIndex {
  readonly indexes: Uint32Array;
  private readonly lons: Int32Array;
  private readonly lats: Int32Array;
  private readonly nodeSize: number;

  constructor(
    lons: Int32Array,
    lats: Int32Array,
    indexes: Uint32Array,
    nodeSize = DEFAULT_NODE_SIZE,
  ) {
    this.lons = lons;
    this.lats = lats;
    this.indexes = indexes;
    this.nodeSize = nodeSize;
  }

  static build(
    lons: Int32Array,
    lats: Int32Array,
    count: number,
    fill: (indexes: Uint32Array) => void,
  ): IndirectKdIndex {
    const buffer = new BufferConstructor(count * Uint32Array.BYTES_PER_ELEMENT);
    const indexes = new Uint32Array(buffer);
    fill(indexes);
    sortKd(indexes, lons, lats, DEFAULT_NODE_SIZE, 0, indexes.length - 1, 0);
    return new IndirectKdIndex(lons, lats, indexes);
  }

  static from(lons: Int32Array, lats: Int32Array, buffer: BufferType): IndirectKdIndex {
    if (buffer.byteLength % Uint32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error("Indirect KD index buffer length must be divisible by four");
    }
    return new IndirectKdIndex(lons, lats, new Uint32Array(buffer));
  }

  get buffer(): BufferType {
    return this.indexes.buffer as BufferType;
  }

  range(minLon: number, minLat: number, maxLon: number, maxLat: number): number[] {
    const stack = [0, this.indexes.length - 1, 0];
    const result: number[] = [];

    while (stack.length > 0) {
      const axis = stack.pop();
      const right = stack.pop();
      const left = stack.pop();
      if (axis === undefined || right === undefined || left === undefined) break;

      if (right - left <= this.nodeSize) {
        for (let i = left; i <= right; i++) {
          const entityIndex = this.indexes[i];
          if (entityIndex === undefined) continue;
          const lon = this.lons[entityIndex];
          const lat = this.lats[entityIndex];
          if (
            lon !== undefined &&
            lat !== undefined &&
            lon >= minLon &&
            lon <= maxLon &&
            lat >= minLat &&
            lat <= maxLat
          ) {
            result.push(entityIndex);
          }
        }
        continue;
      }

      const middle = (left + right) >> 1;
      const entityIndex = this.indexes[middle];
      if (entityIndex === undefined) continue;
      const lon = this.lons[entityIndex];
      const lat = this.lats[entityIndex];
      if (lon === undefined || lat === undefined) continue;

      if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) {
        result.push(entityIndex);
      }

      const coordinate = axis === 0 ? lon : lat;
      const minimum = axis === 0 ? minLon : minLat;
      const maximum = axis === 0 ? maxLon : maxLat;
      if (minimum <= coordinate) stack.push(left, middle - 1, 1 - axis);
      if (maximum >= coordinate) stack.push(middle + 1, right, 1 - axis);
    }

    return result;
  }
}

function sortKd(
  indexes: Uint32Array,
  lons: Int32Array,
  lats: Int32Array,
  nodeSize: number,
  left: number,
  right: number,
  axis: number,
) {
  if (right - left <= nodeSize) return;
  const middle = (left + right) >> 1;
  select(indexes, lons, lats, middle, left, right, axis);
  sortKd(indexes, lons, lats, nodeSize, left, middle - 1, 1 - axis);
  sortKd(indexes, lons, lats, nodeSize, middle + 1, right, 1 - axis);
}

/** Floyd-Rivest selection adapted to dereference coordinates indirectly. */
function select(
  indexes: Uint32Array,
  lons: Int32Array,
  lats: Int32Array,
  k: number,
  initialLeft: number,
  initialRight: number,
  axis: number,
) {
  let left = initialLeft;
  let right = initialRight;

  while (right > left) {
    if (right - left > 600) {
      const n = right - left + 1;
      const m = k - left + 1;
      const z = Math.log(n);
      const s = 0.5 * Math.exp((2 * z) / 3);
      const sd = 0.5 * Math.sqrt((z * s * (n - s)) / n) * (m - n / 2 < 0 ? -1 : 1);
      const newLeft = Math.max(left, Math.floor(k - (m * s) / n + sd));
      const newRight = Math.min(right, Math.floor(k + ((n - m) * s) / n + sd));
      select(indexes, lons, lats, k, newLeft, newRight, axis);
    }

    const pivotIndex = indexes[k];
    if (pivotIndex === undefined) return;
    const pivot = coordinate(lons, lats, pivotIndex, axis);
    let i = left;
    let j = right;

    swap(indexes, left, k);
    const rightIndex = indexes[right];
    if (
      rightIndex !== undefined &&
      compareCoordinate(lons, lats, rightIndex, pivotIndex, axis) > 0
    ) {
      swap(indexes, left, right);
    }

    while (i < j) {
      swap(indexes, i, j);
      i++;
      j--;
      while (i <= right) {
        const index = indexes[i];
        if (index === undefined || coordinate(lons, lats, index, axis) >= pivot) break;
        i++;
      }
      while (j >= left) {
        const index = indexes[j];
        if (index === undefined || coordinate(lons, lats, index, axis) <= pivot) break;
        j--;
      }
    }

    const leftIndex = indexes[left];
    if (leftIndex !== undefined && coordinate(lons, lats, leftIndex, axis) === pivot) {
      swap(indexes, left, j);
    } else {
      j++;
      swap(indexes, j, right);
    }

    if (j <= k) left = j + 1;
    if (k <= j) right = j - 1;
  }
}

function coordinate(lons: Int32Array, lats: Int32Array, entityIndex: number, axis: number): number {
  const value = axis === 0 ? lons[entityIndex] : lats[entityIndex];
  if (value === undefined) throw new Error(`Missing coordinate for node index ${entityIndex}`);
  return value;
}

function compareCoordinate(
  lons: Int32Array,
  lats: Int32Array,
  a: number,
  b: number,
  axis: number,
): number {
  return coordinate(lons, lats, a, axis) - coordinate(lons, lats, b, axis);
}

function swap(indexes: Uint32Array, a: number, b: number) {
  const value = indexes[a];
  if (value === undefined) return;
  indexes[a] = indexes[b] ?? value;
  indexes[b] = value;
}
