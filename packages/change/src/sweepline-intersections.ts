import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";

type Point = [number, number];
type XY = { x: number; y: number };
type Compare<T> = (a: T, b: T) => number;
type SweepGeometry = LineString | MultiLineString | Polygon | MultiPolygon;
type SweepFeature = Feature<SweepGeometry>;
type SweepGeoJson = SweepGeometry | SweepFeature | FeatureCollection<SweepGeometry>;
type Expansion = Float64Array;

/*
 * Typed port of the sweepline-intersections 2.0.1 npm runtime.
 * Source: https://www.npmjs.com/package/sweepline-intersections/v/2.0.1
 * Keep in sync only with a new differential corpus. See THIRD_PARTY_NOTICES.md.
 *
 * sweepline-intersections 2.0.1 — MIT License
 * Copyright (c) 2019 Rowan Winsemius
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * tinyqueue 2.0.3 — ISC License
 * Copyright (c) 2017, Vladimir Agafonkin
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted, provided that the above copyright notice
 * and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
 * OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 * TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
 * THIS SOFTWARE.
 *
 * robust-predicates 2.0.4 — The Unlicense
 * This is free and unencumbered software released into the public domain.
 *
 * Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
 * software, either in source code form or as a compiled binary, for any purpose,
 * commercial or non-commercial, and by any means.
 *
 * In jurisdictions that recognize copyright laws, the author or authors of this
 * software dedicate any and all copyright interest in the software to the public
 * domain. We make this dedication for the benefit of the public at large and to
 * the detriment of our heirs and successors. We intend this dedication to be an
 * overt act of relinquishment in perpetuity of all present and future rights to
 * this software under copyright law.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
 * ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * For more information, please refer to <http://unlicense.org>
 */
class TinyQueue<T> {
  data: T[];
  length: number;
  compare: Compare<T>;

  constructor(data: T[], compare: Compare<T>) {
    this.data = data;
    this.length = this.data.length;
    this.compare = compare;

    if (this.length > 0) {
      for (let i = (this.length >> 1) - 1; i >= 0; i--) this._down(i);
    }
  }

  push(item: T): void {
    this.data.push(item);
    this.length++;
    this._up(this.length - 1);
  }

  pop(): T | undefined {
    if (this.length === 0) return undefined;

    const top = this.data[0];
    const bottom = this.data.pop();
    this.length--;

    if (this.length > 0) {
      this.data[0] = bottom!;
      this._down(0);
    }

    return top;
  }

  peek(): T | undefined {
    return this.data[0];
  }

  _up(pos: number): void {
    const { data, compare } = this;
    let index = pos;
    const item = data[index]!;

    while (index > 0) {
      const parent = (index - 1) >> 1;
      const current = data[parent]!;
      if (compare(item, current) >= 0) break;
      data[index] = current;
      index = parent;
    }

    data[index] = item;
  }

  _down(pos: number): void {
    const { data, compare } = this;
    let index = pos;
    const halfLength = this.length >> 1;
    const item = data[index]!;

    while (index < halfLength) {
      let left = (index << 1) + 1;
      let best = data[left]!;
      const right = left + 1;

      if (right < this.length && compare(data[right]!, best) < 0) {
        left = right;
        best = data[right]!;
      }
      if (compare(best, item) >= 0) break;

      data[index] = best;
      index = left;
    }

    data[index] = item;
  }
}

function checkWhichEventIsLeft(e1: Event, e2: Event): number {
  if (e1.p.x > e2.p.x) return 1;
  if (e1.p.x < e2.p.x) return -1;

  if (e1.p.x === e2.p.x && (e1.featureId !== e2.featureId || e1.ringId !== e2.ringId)) {
    if (e1.isLeftEndpoint && !e2.isLeftEndpoint) return -1;
  }

  if (e1.p.y !== e2.p.y) return e1.p.y > e2.p.y ? 1 : -1;
  return 1;
}

function checkWhichSegmentHasRightEndpointFirst(seg1: Segment, seg2: Segment): number {
  if (seg1.rightSweepEvent.p.x > seg2.rightSweepEvent.p.x) return 1;
  if (seg1.rightSweepEvent.p.x < seg2.rightSweepEvent.p.x) return -1;

  if (seg1.rightSweepEvent.p.y !== seg2.rightSweepEvent.p.y) {
    return seg1.rightSweepEvent.p.y < seg2.rightSweepEvent.p.y ? 1 : -1;
  }
  return 1;
}

class Event {
  p: XY;
  featureId: number;
  ringId: number;
  eventId: number;
  otherEvent: Event | null;
  isLeftEndpoint: boolean | null;

  constructor(p: Position, featureId: number, ringId: number, eventId: number) {
    const x = p[0];
    const y = p[1];
    if (x === undefined || y === undefined) {
      throw Error("Expected a GeoJSON position with at least two coordinates");
    }

    this.p = {
      x,
      y,
    };
    this.featureId = featureId;
    this.ringId = ringId;
    this.eventId = eventId;

    this.otherEvent = null;
    this.isLeftEndpoint = null;
  }

  isSamePoint(eventToCheck: Event): boolean {
    return this.p.x === eventToCheck.p.x && this.p.y === eventToCheck.p.y;
  }

  asNewXY(): Point {
    return [this.p.x, this.p.y];
  }
}

function fillEventQueue(geojson: SweepGeoJson, eventQueue: TinyQueue<Event>): void {
  if (geojson.type === "FeatureCollection") {
    const features = geojson.features;
    for (let i = 0; i < features.length; i++) {
      processFeature(features[i]!, eventQueue);
    }
  } else {
    processFeature(geojson, eventQueue);
  }
}

let featureId = 0;
let ringId = 0;
let eventId = 0;
function processFeature(
  featureOrGeometry: SweepFeature | SweepGeometry,
  eventQueue: TinyQueue<Event>,
): void {
  const geom =
    featureOrGeometry.type === "Feature" ? featureOrGeometry.geometry : featureOrGeometry;
  if (geom === null) throw Error("Expected a GeoJSON feature with geometry");

  // standardise the input
  let coords: Position[][][];
  if (geom.type === "Polygon" || geom.type === "MultiLineString") {
    coords = [geom.coordinates];
  } else if (geom.type === "LineString") {
    coords = [[geom.coordinates]];
  } else {
    coords = geom.coordinates;
  }

  for (let i = 0; i < coords.length; i++) {
    for (let ii = 0; ii < coords[i]!.length; ii++) {
      const ring = coords[i]![ii]!;
      let currentP = ring[0]!;
      let nextP: Position | null = null;
      ringId = ringId + 1;
      for (let iii = 0; iii < ring.length - 1; iii++) {
        nextP = ring[iii + 1]!;

        const e1 = new Event(currentP, featureId, ringId, eventId);
        const e2 = new Event(nextP, featureId, ringId, eventId + 1);

        e1.otherEvent = e2;
        e2.otherEvent = e1;

        if (checkWhichEventIsLeft(e1, e2) > 0) {
          e2.isLeftEndpoint = true;
          e1.isLeftEndpoint = false;
        } else {
          e1.isLeftEndpoint = true;
          e2.isLeftEndpoint = false;
        }
        eventQueue.push(e1);
        eventQueue.push(e2);

        currentP = nextP;
        eventId = eventId + 1;
      }
    }
  }
  featureId = featureId + 1;
}

class Segment {
  leftSweepEvent: Event;
  rightSweepEvent: Event;

  constructor(event: Event) {
    if (event.otherEvent === null) throw Error("Expected a paired sweep event");
    this.leftSweepEvent = event;
    this.rightSweepEvent = event.otherEvent;
  }
}

const epsilon = 1.1102230246251565e-16;
const splitter = 134217729;
const resulterrbound = (3 + 8 * epsilon) * epsilon;

// fast_expansion_sum_zeroelim routine from oritinal code
function sum(elen: number, e: Expansion, flen: number, f: Expansion, h: Expansion): number {
  let Q: number;
  let Qnew: number;
  let hh: number;
  let bvirt: number;
  let enow = e[0]!;
  let fnow = f[0]!;
  let eindex = 0;
  let findex = 0;
  if (fnow > enow === fnow > -enow) {
    Q = enow;
    enow = e[++eindex]!;
  } else {
    Q = fnow;
    fnow = f[++findex]!;
  }
  let hindex = 0;
  if (eindex < elen && findex < flen) {
    if (fnow > enow === fnow > -enow) {
      Qnew = enow + Q;
      hh = Q - (Qnew - enow);
      enow = e[++eindex]!;
    } else {
      Qnew = fnow + Q;
      hh = Q - (Qnew - fnow);
      fnow = f[++findex]!;
    }
    Q = Qnew;
    if (hh !== 0) {
      h[hindex++] = hh;
    }
    while (eindex < elen && findex < flen) {
      if (fnow > enow === fnow > -enow) {
        Qnew = Q + enow;
        bvirt = Qnew - Q;
        hh = Q - (Qnew - bvirt) + (enow - bvirt);
        enow = e[++eindex]!;
      } else {
        Qnew = Q + fnow;
        bvirt = Qnew - Q;
        hh = Q - (Qnew - bvirt) + (fnow - bvirt);
        fnow = f[++findex]!;
      }
      Q = Qnew;
      if (hh !== 0) {
        h[hindex++] = hh;
      }
    }
  }
  while (eindex < elen) {
    Qnew = Q + enow;
    bvirt = Qnew - Q;
    hh = Q - (Qnew - bvirt) + (enow - bvirt);
    enow = e[++eindex]!;
    Q = Qnew;
    if (hh !== 0) {
      h[hindex++] = hh;
    }
  }
  while (findex < flen) {
    Qnew = Q + fnow;
    bvirt = Qnew - Q;
    hh = Q - (Qnew - bvirt) + (fnow - bvirt);
    fnow = f[++findex]!;
    Q = Qnew;
    if (hh !== 0) {
      h[hindex++] = hh;
    }
  }
  if (Q !== 0 || hindex === 0) {
    h[hindex++] = Q;
  }
  return hindex;
}

function estimate(elen: number, e: Expansion): number {
  let Q = e[0]!;
  for (let i = 1; i < elen; i++) Q += e[i]!;
  return Q;
}

function vec(n: number): Expansion {
  return new Float64Array(n);
}

const ccwerrboundA = (3 + 16 * epsilon) * epsilon;
const ccwerrboundB = (2 + 12 * epsilon) * epsilon;
const ccwerrboundC = (9 + 64 * epsilon) * epsilon * epsilon;

const B = vec(4);
const C1 = vec(8);
const C2 = vec(12);
const D = vec(16);
const u = vec(4);

function orient2dadapt(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  detsum: number,
): number {
  let acxtail: number;
  let acytail: number;
  let bcxtail: number;
  let bcytail: number;
  let bvirt: number;
  let c: number;
  let ahi: number;
  let alo: number;
  let bhi: number;
  let blo: number;
  let _i: number;
  let _j: number;
  let _0: number;
  let s1: number;
  let s0: number;
  let t1: number;
  let t0: number;
  let u3: number;

  const acx = ax - cx;
  const bcx = bx - cx;
  const acy = ay - cy;
  const bcy = by - cy;

  s1 = acx * bcy;
  c = splitter * acx;
  ahi = c - (c - acx);
  alo = acx - ahi;
  c = splitter * bcy;
  bhi = c - (c - bcy);
  blo = bcy - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acy * bcx;
  c = splitter * acy;
  ahi = c - (c - acy);
  alo = acy - ahi;
  c = splitter * bcx;
  bhi = c - (c - bcx);
  blo = bcx - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  B[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  B[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u3 = _j + _i;
  bvirt = u3 - _j;
  B[2] = _j - (u3 - bvirt) + (_i - bvirt);
  B[3] = u3;

  let det = estimate(4, B);
  let errbound = ccwerrboundB * detsum;
  if (det >= errbound || -det >= errbound) {
    return det;
  }

  bvirt = ax - acx;
  acxtail = ax - (acx + bvirt) + (bvirt - cx);
  bvirt = bx - bcx;
  bcxtail = bx - (bcx + bvirt) + (bvirt - cx);
  bvirt = ay - acy;
  acytail = ay - (acy + bvirt) + (bvirt - cy);
  bvirt = by - bcy;
  bcytail = by - (bcy + bvirt) + (bvirt - cy);

  if (acxtail === 0 && acytail === 0 && bcxtail === 0 && bcytail === 0) {
    return det;
  }

  errbound = ccwerrboundC * detsum + resulterrbound * Math.abs(det);
  det += acx * bcytail + bcy * acxtail - (acy * bcxtail + bcx * acytail);
  if (det >= errbound || -det >= errbound) return det;

  s1 = acxtail * bcy;
  c = splitter * acxtail;
  ahi = c - (c - acxtail);
  alo = acxtail - ahi;
  c = splitter * bcy;
  bhi = c - (c - bcy);
  blo = bcy - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acytail * bcx;
  c = splitter * acytail;
  ahi = c - (c - acytail);
  alo = acytail - ahi;
  c = splitter * bcx;
  bhi = c - (c - bcx);
  blo = bcx - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  u[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  u[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u3 = _j + _i;
  bvirt = u3 - _j;
  u[2] = _j - (u3 - bvirt) + (_i - bvirt);
  u[3] = u3;
  const C1len = sum(4, B, 4, u, C1);

  s1 = acx * bcytail;
  c = splitter * acx;
  ahi = c - (c - acx);
  alo = acx - ahi;
  c = splitter * bcytail;
  bhi = c - (c - bcytail);
  blo = bcytail - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acy * bcxtail;
  c = splitter * acy;
  ahi = c - (c - acy);
  alo = acy - ahi;
  c = splitter * bcxtail;
  bhi = c - (c - bcxtail);
  blo = bcxtail - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  u[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  u[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u3 = _j + _i;
  bvirt = u3 - _j;
  u[2] = _j - (u3 - bvirt) + (_i - bvirt);
  u[3] = u3;
  const C2len = sum(C1len, C1, 4, u, C2);

  s1 = acxtail * bcytail;
  c = splitter * acxtail;
  ahi = c - (c - acxtail);
  alo = acxtail - ahi;
  c = splitter * bcytail;
  bhi = c - (c - bcytail);
  blo = bcytail - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acytail * bcxtail;
  c = splitter * acytail;
  ahi = c - (c - acytail);
  alo = acytail - ahi;
  c = splitter * bcxtail;
  bhi = c - (c - bcxtail);
  blo = bcxtail - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  u[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  u[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u3 = _j + _i;
  bvirt = u3 - _j;
  u[2] = _j - (u3 - bvirt) + (_i - bvirt);
  u[3] = u3;
  const Dlen = sum(C2len, C2, 4, u, D);

  return D[Dlen - 1]!;
}

function orient2d(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const detleft = (ay - cy) * (bx - cx);
  const detright = (ax - cx) * (by - cy);
  const det = detleft - detright;

  if (detleft === 0 || detright === 0 || detleft > 0 !== detright > 0) return det;

  const detsum = Math.abs(detleft + detright);
  if (Math.abs(det) >= ccwerrboundA * detsum) return det;

  return -orient2dadapt(ax, ay, bx, by, cx, cy, detsum);
}

function testSegmentIntersect(seg1: Segment | null, seg2: Segment | null): Point | false {
  if (seg1 === null || seg2 === null) return false;

  const x1 = seg1.leftSweepEvent.p.x;
  const y1 = seg1.leftSweepEvent.p.y;
  const x2 = seg1.rightSweepEvent.p.x;
  const y2 = seg1.rightSweepEvent.p.y;
  const x3 = seg2.leftSweepEvent.p.x;
  const y3 = seg2.leftSweepEvent.p.y;
  const x4 = seg2.rightSweepEvent.p.x;
  const y4 = seg2.rightSweepEvent.p.y;

  const score1 = orient2d(x1, y1, x2, y2, x3, y3);
  const score2 = orient2d(x1, y1, x2, y2, x4, y4);

  if (score1 > 0 && score2 > 0) return false;
  else if (score1 < 0 && score2 < 0) return false;

  if (seg1.leftSweepEvent.ringId === seg2.leftSweepEvent.ringId) {
    if (
      seg1.rightSweepEvent.isSamePoint(seg2.leftSweepEvent) ||
      seg1.rightSweepEvent.isSamePoint(seg2.rightSweepEvent) ||
      seg1.leftSweepEvent.isSamePoint(seg2.leftSweepEvent) ||
      seg1.leftSweepEvent.isSamePoint(seg2.rightSweepEvent)
    )
      return false;
  } else {
    if (seg1.rightSweepEvent.isSamePoint(seg2.leftSweepEvent)) return seg2.leftSweepEvent.asNewXY();
    if (seg1.rightSweepEvent.isSamePoint(seg2.rightSweepEvent))
      return seg2.rightSweepEvent.asNewXY();
    if (seg1.leftSweepEvent.isSamePoint(seg2.leftSweepEvent)) return seg2.leftSweepEvent.asNewXY();
    if (seg1.leftSweepEvent.isSamePoint(seg2.rightSweepEvent))
      return seg2.rightSweepEvent.asNewXY();
  }

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  const numeA = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3);
  const numeB = (x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3);

  if (denom === 0) {
    if (numeA === 0 && numeB === 0) return false;
    return false;
  }

  const uA = numeA / denom;
  const uB = numeB / denom;

  if (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1) {
    const x = x1 + uA * (x2 - x1);
    const y = y1 + uA * (y2 - y1);
    return [x, y];
  }
  return false;
}

// import {debugEventAndSegments, debugRemovingSegment} from './debug'

function runCheck(
  eventQueue: TinyQueue<Event>,
  ignoreSelfIntersections: boolean | undefined,
): Point[] {
  const shouldIgnoreSelfIntersections = ignoreSelfIntersections ? ignoreSelfIntersections : false;

  const intersectionPoints: Point[] = [];
  const outQueue = new TinyQueue<Segment>([], checkWhichSegmentHasRightEndpointFirst);

  while (eventQueue.length) {
    const event = eventQueue.pop();
    if (event === undefined) throw Error("Expected a queued sweep event");
    if (event.isLeftEndpoint) {
      // debugEventAndSegments(event.p, outQueue.data)
      const segment = new Segment(event);
      for (let i = 0; i < outQueue.data.length; i++) {
        const otherSeg = outQueue.data[i]!;
        if (shouldIgnoreSelfIntersections) {
          if (otherSeg.leftSweepEvent.featureId === event.featureId) continue;
        }
        const intersection = testSegmentIntersect(segment, otherSeg);
        if (intersection !== false) intersectionPoints.push(intersection);
      }
      outQueue.push(segment);
    } else if (event.isLeftEndpoint === false) {
      outQueue.pop();
      // const seg = outQueue.pop()
      // debugRemovingSegment(event.p, seg)
    }
  }
  return intersectionPoints;
}

function sweeplineIntersectionsRuntime(
  geojson: SweepGeoJson,
  ignoreSelfIntersections: boolean | undefined,
): Point[] {
  const eventQueue = new TinyQueue<Event>([], checkWhichEventIsLeft);
  fillEventQueue(geojson, eventQueue);
  return runCheck(eventQueue, ignoreSelfIntersections);
}

export default function sweeplineIntersections(
  geojson: FeatureCollection<LineString>,
  ignoreSelfIntersections = false,
): [number, number][] {
  return sweeplineIntersectionsRuntime(geojson, ignoreSelfIntersections);
}
