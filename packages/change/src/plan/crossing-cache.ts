/**
 * Work the crossings phase can reuse across replans (MP-P4). A decision changes a few ways, but
 * the phase searches and intersects every imported way again. Both steps cached here are pure:
 * the ways near a box in the phase's starting state, and the points where two lines cross. So a
 * replan that reuses them finds exactly what a fresh plan finds.
 */
import { bboxContainsOrIntersects } from "@osmix/geo/bbox-intersects";
import type { GeoBbox2D } from "@osmix/types";
import { dequal } from "dequal";

import type { PlanOverlay } from "./overlay.ts";

interface PairEntry {
  /** The two ways' geometry revisions the points were found at. */
  revision: number;
  otherRevision: number;
  points: [number, number][];
  pass: number;
}

export class CrossingCache {
  private pass = 0;
  private start: PlanOverlay | undefined;
  /** Ways whose geometry differs from the previous pass's start, with their current box. */
  private changed = new Map<number, GeoBbox2D | null>();
  private readonly near = new NearWays();
  private readonly pairs = new Map<string, PairEntry>();

  /** Start a pass on `start`, the planned state the phase reads, and forget what it cannot use. */
  begin(start: PlanOverlay) {
    const previous = this.start;
    this.pass++;
    this.start = start;
    this.changed = previous ? changedWays(previous, start) : new Map();
    // An entry is exact for the previous pass's start; older ones missed its changes.
    this.near.retain(
      (id, pass) => previous != null && pass === this.pass - 1 && !this.changed.has(id),
    );
    for (const [key, entry] of this.pairs) {
      if (entry.pass !== this.pass - 1) this.pairs.delete(key);
    }
  }

  /** Ways near `wayId`'s box `bbox` in the start, as `search` finds them, in ascending ID order. */
  nearWays(wayId: number, bbox: GeoBbox2D, search: (bbox: GeoBbox2D) => number[]): number[] {
    const cached = this.near.get(wayId, bbox);
    let ids: number[];
    if (cached) {
      ids = [];
      for (const id of cached) if (!this.changed.has(id)) ids.push(id);
      for (const [id, changedBbox] of this.changed) {
        if (changedBbox && bboxContainsOrIntersects(changedBbox, bbox)) ids.push(id);
      }
      ids.sort((a, b) => a - b);
    } else {
      ids = search(bbox);
    }
    this.near.set(wayId, bbox, ids, this.pass);
    return ids;
  }

  /** Forget every pass: the next one searches and intersects from scratch. */
  clear() {
    this.start = undefined;
    this.changed = new Map();
    this.near.clear();
    this.pairs.clear();
  }

  /**
   * The pass is over. Its start is kept only to compare with the next pass's start, so the
   * spatial grid and coordinates it built for searching are released.
   */
  end() {
    this.start?.releaseDerived();
  }

  /**
   * Where two ways cross, as `intersect` finds them, reused while neither way's geometry has
   * changed (its revision in the planned state is the same). Only pairs that cross are kept:
   * most pairs of nearby ways do not, and an entry holds no coordinates (T34, T35).
   */
  crossingPoints(
    wayId: number,
    revision: number,
    otherId: number,
    otherRevision: number,
    intersect: () => [number, number][],
  ): [number, number][] {
    const key = `${wayId}:${otherId}`;
    const entry = this.pairs.get(key);
    if (entry && entry.revision === revision && entry.otherRevision === otherRevision) {
      entry.pass = this.pass;
      return entry.points;
    }
    const points = intersect();
    if (points.length > 0) {
      this.pairs.set(key, { revision, otherRevision, points, pass: this.pass });
    } else this.pairs.delete(key);
    return points;
  }
}

/**
 * Ways whose refs, or the position of a node they use, differ between two states of the same
 * base, with each one's box in `current` (null when absent). Only records can differ.
 */
function changedWays(previous: PlanOverlay, current: PlanOverlay) {
  const changed = new Set<number>();
  for (const id of recordIds(previous, current, "way")) {
    const before = previous.getWay(id);
    const after = current.getWay(id);
    if (!dequal(before?.refs, after?.refs)) changed.add(id);
  }
  for (const id of recordIds(previous, current, "node")) {
    const before = previous.getNode(id);
    const after = current.getNode(id);
    if (before?.lon === after?.lon && before?.lat === after?.lat) continue;
    for (const way of previous.waysAtNode(id)) changed.add(way.id);
    for (const way of current.waysAtNode(id)) changed.add(way.id);
  }
  const boxes = new Map<number, GeoBbox2D | null>();
  for (const id of changed) {
    const way = current.getWay(id);
    boxes.set(id, way ? current.wayBbox(way) : null);
  }
  return boxes;
}

function recordIds(previous: PlanOverlay, current: PlanOverlay, type: "node" | "way") {
  // Only records of their own can differ: both states read untouched imports from one patch.
  return new Set([
    ...previous.changes(type).overrideKeys(),
    ...current.changes(type).overrideKeys(),
  ]);
}

/**
 * Each way's near ways, by the box they were found for and the pass that found them, in typed
 * arrays: one object and two arrays per imported way cost about three times as much (T35).
 * A slot per way holds its box, pass and the span of its IDs in a shared pool; a span that
 * grows moves to the pool's end, and the pool is compacted when most of it is unused.
 */
class NearWays {
  private readonly slots = new Map<number, number>();
  private boxes = new Float64Array(0);
  /** The pass that set each slot; 0 for an empty slot. */
  private passes = new Int32Array(0);
  private starts = new Float64Array(0);
  private lengths = new Float64Array(0);
  private capacities = new Float64Array(0);
  private pool = new Float64Array(0);
  private poolUsed = 0;
  private live = 0;

  /** The IDs found for `wayId` at exactly `bbox`, or undefined. */
  get(wayId: number, bbox: GeoBbox2D): Float64Array | undefined {
    const slot = this.slots.get(wayId);
    if (slot === undefined || this.passes[slot] === 0) return undefined;
    const box = slot * 4;
    for (let i = 0; i < 4; i++) if (this.boxes[box + i] !== bbox[i]) return undefined;
    const start = this.starts[slot]!;
    return this.pool.subarray(start, start + this.lengths[slot]!);
  }

  set(wayId: number, bbox: GeoBbox2D, ids: readonly number[], pass: number) {
    let slot = this.slots.get(wayId);
    if (slot === undefined) {
      slot = this.slots.size;
      this.slots.set(wayId, slot);
      this.growSlots(slot + 1);
    }
    if (this.passes[slot] === 0) this.live += ids.length;
    else this.live += ids.length - this.lengths[slot]!;
    this.boxes.set(bbox, slot * 4);
    this.passes[slot] = pass;
    if (this.capacities[slot]! < ids.length) {
      this.starts[slot] = this.allocate(ids.length);
      this.capacities[slot] = ids.length;
    }
    this.pool.set(ids, this.starts[slot]!);
    this.lengths[slot] = ids.length;
  }

  /** Keep only entries `keep` accepts, by way ID and the pass that set them. */
  retain(keep: (wayId: number, pass: number) => boolean) {
    for (const [wayId, slot] of this.slots) {
      const pass = this.passes[slot]!;
      if (pass === 0 || keep(wayId, pass)) continue;
      this.passes[slot] = 0;
      this.live -= this.lengths[slot]!;
    }
  }

  clear() {
    this.slots.clear();
    this.boxes = new Float64Array(0);
    this.passes = new Int32Array(0);
    this.starts = new Float64Array(0);
    this.lengths = new Float64Array(0);
    this.capacities = new Float64Array(0);
    this.pool = new Float64Array(0);
    this.poolUsed = 0;
    this.live = 0;
  }

  private growSlots(size: number) {
    if (size <= this.passes.length) return;
    const capacity = Math.max(size, this.passes.length * 2, 1024);
    this.boxes = grown(this.boxes, capacity * 4);
    this.passes = grown(this.passes, capacity);
    this.starts = grown(this.starts, capacity);
    this.lengths = grown(this.lengths, capacity);
    this.capacities = grown(this.capacities, capacity);
  }

  /** Room for `length` IDs at the pool's end, compacting or growing it first if needed. */
  private allocate(length: number) {
    if (this.poolUsed + length > this.pool.length) {
      if (this.live * 2 < this.poolUsed) this.compact();
      if (this.poolUsed + length > this.pool.length) {
        this.pool = grown(this.pool, Math.max(this.poolUsed + length, this.pool.length * 2, 4096));
      }
    }
    const start = this.poolUsed;
    this.poolUsed += length;
    return start;
  }

  /** Move every entry's IDs to the front of a pool just big enough for them. */
  private compact() {
    const pool = new Float64Array(Math.max(this.live * 2, 4096));
    let used = 0;
    for (const slot of this.slots.values()) {
      if (this.passes[slot] === 0) {
        this.capacities[slot] = 0;
        continue;
      }
      const start = this.starts[slot]!;
      const length = this.lengths[slot]!;
      pool.set(this.pool.subarray(start, start + length), used);
      this.starts[slot] = used;
      this.capacities[slot] = length;
      used += length;
    }
    this.pool = pool;
    this.poolUsed = used;
  }
}

/** `array`'s values at the start of a new array of `length`. */
function grown<T extends Float64Array | Int32Array>(array: T, length: number): T {
  const next = new (array.constructor as new (length: number) => T)(length);
  next.set(array);
  return next;
}
