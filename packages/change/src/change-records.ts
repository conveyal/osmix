/**
 * Change records by entity ID (T35). A plan's records were plain objects keyed by ID; this table
 * keeps their meaning, including the order they iterate in, behind one access point, so a
 * plan can answer for untouched imported entities from the patch instead of storing a record
 * for each.
 */
import type { OsmEntity } from "@osmix/types";

import type { OsmChange } from "./types.ts";

/** The largest key a plain object orders as an array index (2^32 - 2). */
const MAX_INDEX_KEY = 4_294_967_294;

const isIndexKey = (id: number) => Number.isInteger(id) && id >= 0 && id <= MAX_INDEX_KEY;

/**
 * Records by ID. `undefined` is a dropped record: the entity reads as having no change (as it is
 * in the base, or absent). Keys iterate as a plain object's did: IDs from 0 to 2^32 - 2
 * ascending, then the rest in the order they were first set, so outputs built from records keep
 * their order.
 */
export class ChangeRecordTable<T extends OsmEntity = OsmEntity> {
  private readonly records = new Map<number, OsmChange<T> | undefined>();

  /** The record for `id`, or undefined when there is none or it was dropped. */
  get(id: number): OsmChange<T> | undefined {
    return this.records.get(id);
  }

  /** Whether `id` has a record or a dropped one. */
  has(id: number): boolean {
    return this.records.has(id);
  }

  set(id: number, change: OsmChange<T> | undefined) {
    this.records.set(id, change);
  }

  /** Remove `id` entirely, as if it never had a record; a later `set` goes last in order. */
  delete(id: number) {
    this.records.delete(id);
  }

  /** How many IDs have a record or a dropped one. */
  get size() {
    return this.records.size;
  }

  /** A copy with the same records and order, unaffected by later writes to either. */
  copy(): ChangeRecordTable<T> {
    const copy = new ChangeRecordTable<T>();
    for (const [id, change] of this.records) copy.records.set(id, change);
    return copy;
  }

  /** Every ID with a record or a dropped one, in record order. */
  *keys(): Generator<number> {
    const indexKeys: number[] = [];
    for (const id of this.records.keys()) if (isIndexKey(id)) indexKeys.push(id);
    indexKeys.sort((a, b) => a - b);
    yield* indexKeys;
    for (const id of this.records.keys()) if (!isIndexKey(id)) yield id;
  }

  /** Every record, in record order; dropped records are skipped. */
  *values(): Generator<OsmChange<T>> {
    for (const id of this.keys()) {
      const change = this.records.get(id);
      if (change) yield change;
    }
  }
}
