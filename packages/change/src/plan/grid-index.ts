/**
 * A mutable hash grid of bounding boxes. The planner overlay keeps pending geometry here, since
 * the base dataset's packed spatial indexes cannot change. Queries return the IDs whose stored
 * box intersects the query box; callers keep the stored boxes current.
 */
import { bboxContainsOrIntersects } from "@osmix/geo/bbox-intersects";
import type { GeoBbox2D } from "@osmix/types";

/** About 1 km at the equator: pending changes are sparse, and queries are small. */
const DEFAULT_CELL_DEGREES = 0.01;
/** A box covering more cells than this is kept in a short list tested by every query. */
const MAX_CELLS_PER_ENTRY = 64;
const CELL_KEY_STRIDE = 1 << 17;

export class GridIndex {
  private readonly cells = new Map<number, Set<number>>();
  private readonly oversized = new Set<number>();
  /**
   * Each entry's slot in typed arrays: its box, and the first cell it is in (NaN when
   * oversized), with any further cells in a short list. An object and two arrays per entry
   * cost several times as much on large plans (T35).
   */
  private readonly slots = new Map<number, number>();
  private readonly freeSlots: number[] = [];
  private boxes = new Float64Array(0);
  private firstCells = new Float64Array(0);
  private moreCells: (number[] | undefined)[] = [];
  /** One entry's box, for testing it without allocating. */
  private readonly box: GeoBbox2D = [0, 0, 0, 0];

  private readonly cellDegrees: number;

  constructor(cellDegrees = DEFAULT_CELL_DEGREES) {
    this.cellDegrees = cellDegrees;
  }

  get size() {
    return this.slots.size;
  }

  has(id: number) {
    return this.slots.has(id);
  }

  /** Insert `id`, or move it to `bbox`. */
  set(id: number, bbox: GeoBbox2D) {
    this.remove(id);
    const slot = this.freeSlots.pop() ?? this.slots.size;
    this.slots.set(id, slot);
    this.reserve(slot + 1);
    this.boxes.set(bbox, slot * 4);
    const [minX, minY, maxX, maxY] = this.cellRange(bbox);
    if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_CELLS_PER_ENTRY) {
      this.firstCells[slot] = Number.NaN;
      this.oversized.add(id);
      return;
    }
    let more: number[] | undefined;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = x * CELL_KEY_STRIDE + y;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = new Set();
          this.cells.set(key, cell);
        }
        cell.add(id);
        if (x === minX && y === minY) this.firstCells[slot] = key;
        else (more ??= []).push(key);
      }
    }
    this.moreCells[slot] = more;
  }

  remove(id: number) {
    const slot = this.slots.get(id);
    if (slot === undefined) return;
    this.slots.delete(id);
    this.freeSlots.push(slot);
    if (this.oversized.delete(id)) return;
    this.leaveCell(this.firstCells[slot]!, id);
    for (const key of this.moreCells[slot] ?? []) this.leaveCell(key, id);
    this.moreCells[slot] = undefined;
  }

  /** IDs whose stored box intersects or touches `bbox`, in no particular order. */
  query(bbox: GeoBbox2D): Set<number> {
    const result = new Set<number>();
    const box = this.box;
    const test = (id: number) => {
      if (result.has(id)) return;
      const at = this.slots.get(id)! * 4;
      for (let i = 0; i < 4; i++) box[i] = this.boxes[at + i]!;
      if (bboxContainsOrIntersects(box, bbox)) result.add(id);
    };
    for (const id of this.oversized) test(id);
    const [minX, minY, maxX, maxY] = this.cellRange(bbox);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const cell = this.cells.get(x * CELL_KEY_STRIDE + y);
        if (cell) for (const id of cell) test(id);
      }
    }
    return result;
  }

  private leaveCell(key: number, id: number) {
    const cell = this.cells.get(key)!;
    cell.delete(id);
    if (cell.size === 0) this.cells.delete(key);
  }

  /** Room for `size` slots. */
  private reserve(size: number) {
    if (size <= this.firstCells.length) return;
    const capacity = Math.max(size, this.firstCells.length * 2, 1024);
    const boxes = new Float64Array(capacity * 4);
    boxes.set(this.boxes);
    this.boxes = boxes;
    const firstCells = new Float64Array(capacity);
    firstCells.set(this.firstCells);
    this.firstCells = firstCells;
  }

  private cellRange(bbox: GeoBbox2D): GeoBbox2D {
    // Offset so cell coordinates stay positive and fit the key stride.
    const cell = (degrees: number) => Math.floor((degrees + 360) / this.cellDegrees);
    return [cell(bbox[0]), cell(bbox[1]), cell(bbox[2]), cell(bbox[3])];
  }
}
