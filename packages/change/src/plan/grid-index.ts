/**
 * A mutable hash grid of bounding boxes. The planner overlay keeps pending geometry here, since
 * the base dataset's packed spatial indexes cannot change. Queries return candidates; callers
 * re-test them against current geometry.
 */
import type { GeoBbox2D } from "@osmix/types";

/** About 1 km at the equator: pending changes are sparse, and queries are small. */
const DEFAULT_CELL_DEGREES = 0.01;
/** A box covering more cells than this is kept in a short list tested by every query. */
const MAX_CELLS_PER_ENTRY = 64;
const CELL_KEY_STRIDE = 1 << 17;

export class GridIndex {
  private readonly cells = new Map<number, Set<number>>();
  private readonly entryCells = new Map<number, number[]>();
  private readonly oversized = new Set<number>();

  private readonly cellDegrees: number;

  constructor(cellDegrees = DEFAULT_CELL_DEGREES) {
    this.cellDegrees = cellDegrees;
  }

  get size() {
    return this.entryCells.size + this.oversized.size;
  }

  has(id: number) {
    return this.entryCells.has(id) || this.oversized.has(id);
  }

  /** Insert `id`, or move it to `bbox`. */
  set(id: number, bbox: GeoBbox2D) {
    this.remove(id);
    const [minX, minY, maxX, maxY] = this.cellRange(bbox);
    if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_CELLS_PER_ENTRY) {
      this.oversized.add(id);
      return;
    }
    const keys: number[] = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = x * CELL_KEY_STRIDE + y;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = new Set();
          this.cells.set(key, cell);
        }
        cell.add(id);
        keys.push(key);
      }
    }
    this.entryCells.set(id, keys);
  }

  remove(id: number) {
    if (this.oversized.delete(id)) return;
    const keys = this.entryCells.get(id);
    if (!keys) return;
    for (const key of keys) {
      const cell = this.cells.get(key)!;
      cell.delete(id);
      if (cell.size === 0) this.cells.delete(key);
    }
    this.entryCells.delete(id);
  }

  /** IDs whose box may intersect `bbox`, in no particular order. */
  query(bbox: GeoBbox2D): Set<number> {
    const result = new Set(this.oversized);
    const [minX, minY, maxX, maxY] = this.cellRange(bbox);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (const id of this.cells.get(x * CELL_KEY_STRIDE + y) ?? []) result.add(id);
      }
    }
    return result;
  }

  private cellRange(bbox: GeoBbox2D): GeoBbox2D {
    // Offset so cell coordinates stay positive and fit the key stride.
    const cell = (degrees: number) => Math.floor((degrees + 360) / this.cellDegrees);
    return [cell(bbox[0]), cell(bbox[1]), cell(bbox[2]), cell(bbox[3])];
  }
}
