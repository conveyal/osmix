/**
 * Change records by entity ID (T35). A plan's records were plain objects keyed by ID; this table
 * keeps their meaning, including the order they iterate in, behind one access point, so a plan
 * can answer for untouched imported entities from the patch (its layer) instead of storing a
 * record for each.
 */
import type { OsmEntity } from "@osmix/types";

import type { OsmChange } from "./types.ts";

/** The largest key a plain object orders as an array index (2^32 - 2). */
const MAX_INDEX_KEY = 4_294_967_294;

const isIndexKey = (id: number) => Number.isInteger(id) && id >= 0 && id <= MAX_INDEX_KEY;

/**
 * Imported entities a plan has not changed, read from the patch: each reads as the create record
 * the direct phase would have stored for it.
 */
export interface RecordLayer<T extends OsmEntity> {
  /** The dataset the entities come from, for their records' `osmId`. */
  readonly osmId: string;
  /** Whether `id` is one of the layer's entities. */
  has(id: number): boolean;
  /** The layer's entity `id`, decoded, as the direct phase would have recorded it. */
  get(id: number): T | null;
  /** The layer's IDs from 0 to 2^32 - 2, ascending. */
  readonly indexIds: readonly number[] | ArrayLike<number>;
  /** The layer's other IDs, in patch order. */
  readonly otherIds: readonly number[] | ArrayLike<number>;
  /** Where a patch entity is in patch order (layer or not), or undefined when it is not one. */
  position(id: number): number | undefined;
  /** How many entities the patch has of this type. */
  readonly patchSize: number;
}

/**
 * Records by ID. `undefined` is a dropped record: the entity reads as having no change (as it is
 * in the base, or absent). Keys iterate as a plain object's did: IDs from 0 to 2^32 - 2
 * ascending, then the rest in the order they were first set; a layer entity takes its patch
 * position, as the direct phase set it first, before any later phase.
 */
export class ChangeRecordTable<T extends OsmEntity = OsmEntity> {
  private readonly records = new Map<number, OsmChange<T> | undefined>();
  /** When each key outside the index range was first set, for order. */
  private readonly order = new Map<number, number>();
  private nextOrder: number;
  private readonly layer: RecordLayer<T> | undefined;

  constructor(layer?: RecordLayer<T>) {
    this.layer = layer;
    this.nextOrder = layer?.patchSize ?? 0;
  }

  /** The record for `id`, or undefined when there is none or it was dropped. */
  get(id: number): OsmChange<T> | undefined {
    const own = this.records.get(id);
    if (own !== undefined || this.records.has(id)) return own;
    return this.layerRecord(id);
  }

  /** Whether `id` has a record or a dropped one. */
  has(id: number): boolean {
    return this.records.has(id) || (this.layer?.has(id) ?? false);
  }

  /** Whether `id` has a record of its own (not the layer's) or a dropped one. */
  hasOverride(id: number): boolean {
    return this.records.has(id);
  }

  /**
   * Set the record for `id`. `direct` marks a write of the direct phase, which comes first:
   * a patch entity's key then takes its patch position.
   */
  set(id: number, change: OsmChange<T> | undefined, { direct = false } = {}) {
    if (!this.records.has(id) && !isIndexKey(id) && !this.layer?.has(id)) {
      const position = direct ? this.layer?.position(id) : undefined;
      this.order.set(id, position ?? this.nextOrder++);
    }
    this.records.set(id, change);
  }

  /** Remove `id`'s own record: it reads from the layer again, or has none; a later `set` is last. */
  delete(id: number) {
    this.records.delete(id);
    this.order.delete(id);
  }

  /** How many IDs have a record of their own or a dropped one (layer entities not counted). */
  get size() {
    return this.records.size;
  }

  /** A copy with the same records, layer and order, unaffected by later writes to either. */
  copy(): ChangeRecordTable<T> {
    const copy = new ChangeRecordTable<T>(this.layer);
    for (const [id, change] of this.records) copy.records.set(id, change);
    for (const [id, order] of this.order) copy.order.set(id, order);
    copy.nextOrder = this.nextOrder;
    return copy;
  }

  /** IDs with a record of their own or a dropped one: what can differ from the layer. */
  overrideKeys(): IterableIterator<number> {
    return this.records.keys();
  }

  /** Records of their own, unordered: what can differ from the layer. */
  *overrideValues(): Generator<OsmChange<T>> {
    for (const change of this.records.values()) if (change) yield change;
  }

  /** Every ID with a record (its own or the layer's) or a dropped one, in record order. */
  *keys(): Generator<number> {
    const layer = this.layer;
    const ownIndex: number[] = [];
    const ownOther: number[] = [];
    for (const id of this.records.keys()) {
      if (layer?.has(id)) continue;
      (isIndexKey(id) ? ownIndex : ownOther).push(id);
    }
    ownIndex.sort((a, b) => a - b);
    ownOther.sort((a, b) => this.order.get(a)! - this.order.get(b)!);
    yield* merge(layer?.indexIds ?? [], ownIndex, (id) => id);
    yield* merge(layer?.otherIds ?? [], ownOther, (id) =>
      this.order.has(id) ? this.order.get(id)! : layer!.position(id)!,
    );
  }

  /** Every record (its own or the layer's), in record order; dropped records are skipped. */
  *values(): Generator<OsmChange<T>> {
    for (const id of this.keys()) {
      const change = this.get(id);
      if (change) yield change;
    }
  }

  /** The layer's record for `id`, ignoring any record of its own. */
  layerRecord(id: number): OsmChange<T> | undefined {
    const layer = this.layer;
    const entity = layer?.get(id);
    return entity ? { changeType: "create", entity, osmId: layer!.osmId } : undefined;
  }

  /**
   * How many records (own or the layer's) there are of each change type, as `values()` would
   * list them, without decoding the layer's entities: each one not overridden is a create.
   */
  countByType(): Record<OsmChange["changeType"], number> {
    const counts = { create: 0, modify: 0, delete: 0 };
    const layer = this.layer;
    let overridden = 0;
    for (const [id, change] of this.records) {
      if (layer?.has(id)) overridden++;
      if (change) counts[change.changeType]++;
    }
    if (layer) counts.create += layer.indexIds.length + layer.otherIds.length - overridden;
    return counts;
  }
}

/** Two lists each sorted by `rank`, as one sorted list. */
function* merge(
  a: readonly number[] | ArrayLike<number>,
  b: readonly number[],
  rank: (id: number) => number,
): Generator<number> {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && rank(a[i]!) <= rank(b[j]!))) yield a[i++]!;
    else yield b[j++]!;
  }
}
