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

type Line = [number, number][];

interface NearEntry {
  bbox: GeoBbox2D;
  ids: number[];
  pass: number;
}

interface PairEntry {
  line: Line;
  other: Line;
  points: [number, number][];
  pass: number;
}

export class CrossingCache {
  private pass = 0;
  private start: PlanOverlay | undefined;
  /** Ways whose geometry differs from the previous pass's start, with their current box. */
  private changed = new Map<number, GeoBbox2D | null>();
  private readonly near = new Map<number, NearEntry>();
  private readonly pairs = new Map<string, PairEntry>();

  /** Start a pass on `start`, the planned state the phase reads, and forget what it cannot use. */
  begin(start: PlanOverlay) {
    const previous = this.start;
    this.pass++;
    this.start = start;
    this.changed = previous ? changedWays(previous, start) : new Map();
    for (const [id, entry] of this.near) {
      // An entry is exact for the previous pass's start; older ones missed its changes.
      if (!previous || entry.pass !== this.pass - 1 || this.changed.has(id)) this.near.delete(id);
    }
    for (const [key, entry] of this.pairs) {
      if (entry.pass !== this.pass - 1) this.pairs.delete(key);
    }
  }

  /** Ways near `wayId`'s box `bbox` in the start, as `search` finds them, in ascending ID order. */
  nearWays(wayId: number, bbox: GeoBbox2D, search: (bbox: GeoBbox2D) => number[]): number[] {
    const entry = this.near.get(wayId);
    let ids: number[];
    if (entry && dequal(entry.bbox, bbox)) {
      ids = entry.ids.filter((id) => !this.changed.has(id));
      for (const [id, changedBbox] of this.changed) {
        if (changedBbox && bboxContainsOrIntersects(changedBbox, bbox)) ids.push(id);
      }
      ids.sort((a, b) => a - b);
    } else {
      ids = search(bbox);
    }
    this.near.set(wayId, { bbox, ids, pass: this.pass });
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
   * Where two lines cross, as `intersect` finds them, reused while both lines are unchanged.
   * Only pairs that cross are kept: most pairs of nearby ways do not, and keeping both lines
   * of each such pair held a copy of the plan's geometry (T34).
   */
  crossingPoints(
    wayId: number,
    line: Line,
    otherId: number,
    other: Line,
    intersect: (line: Line, other: Line) => [number, number][],
  ): [number, number][] {
    const key = `${wayId}:${otherId}`;
    const entry = this.pairs.get(key);
    if (entry && dequal(entry.line, line) && dequal(entry.other, other)) {
      entry.pass = this.pass;
      return entry.points;
    }
    const points = intersect(line, other);
    if (points.length > 0) this.pairs.set(key, { line, other, points, pass: this.pass });
    else this.pairs.delete(key);
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
