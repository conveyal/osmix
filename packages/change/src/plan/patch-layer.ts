/**
 * The patch as a plan's read-only layer (T35): its entities whose IDs the base does not have,
 * read from the patch's packed columns instead of one stored record each. An entity a phase
 * changes gets a record of its own over its layer one.
 */
import type { Osm } from "@osmix/core";
import type { OsmEntityType, OsmEntityTypeMap } from "@osmix/types";

import type { RecordLayer } from "../change-records.ts";
import { removeDuplicateAdjacentWayRefs } from "../utils.ts";

const MAX_INDEX_KEY = 4_294_967_294;

/**
 * Recently read layer entities kept decoded, per type. Phases read nearby entities again and
 * again (crossings test each way against its neighbours); a bound keeps this from becoming the
 * copy of the patch the layer replaced. Entities are never mutated in place, so sharing one
 * decoded object between reads is safe, as sharing a stored record was.
 */
const DECODED_CACHE_SIZE = 1 << 15;
const DECODED_CACHE_MASK = DECODED_CACHE_SIZE - 1;

/** A slot for `id` in the decoded cache: one entity per slot, replaced on a miss. */
const slotOf = (id: number) => (Math.imul(id | 0, 0x9e3779b1) >>> 17) & DECODED_CACHE_MASK;

type Entities<T extends OsmEntityType> = Osm[`${T}s`];

/** One entity type's layer over `base`; ways read as the direct phase recorded them. */
function layerOf<T extends OsmEntityType>(
  type: T,
  base: Osm,
  patch: Osm,
): RecordLayer<OsmEntityTypeMap[T]> {
  const entities = patch[`${type}s`] as Entities<T>;
  const baseIds = (base[`${type}s`] as Entities<T>).ids;
  const ids = entities.ids;
  const indexIds: number[] = [];
  const otherIds: number[] = [];
  // Whether each patch entity, by index, is in the layer: a read then looks its ID up once.
  const inLayer = new Uint8Array(entities.size);
  for (let index = 0; index < entities.size; index++) {
    const id = ids.at(index);
    if (baseIds.has(id)) continue;
    inLayer[index] = 1;
    if (Number.isInteger(id) && id >= 0 && id <= MAX_INDEX_KEY) indexIds.push(id);
    else otherIds.push(id);
  }
  indexIds.sort((a, b) => a - b);
  /** The patch index of layer entity `id`, or -1. */
  const indexOf = (id: number) => {
    const index = ids.getIndexFromId(id);
    return index >= 0 && inLayer[index] === 1 ? index : -1;
  };
  const cachedIds = new Float64Array(DECODED_CACHE_SIZE).fill(Number.NaN);
  const cached: (OsmEntityTypeMap[T] | undefined)[] = Array.from({ length: DECODED_CACHE_SIZE });
  const decode = (index: number) => {
    const entity = entities.getByIndex(index) as OsmEntityTypeMap[T];
    if (type !== "way") return entity;
    return removeDuplicateAdjacentWayRefs(entity as OsmEntityTypeMap["way"]) as OsmEntityTypeMap[T];
  };
  return {
    osmId: patch.id,
    has: (id) => indexOf(id) >= 0,
    get: (id) => {
      const slot = slotOf(id);
      if (cachedIds[slot] === id) return cached[slot]!;
      const index = indexOf(id);
      if (index < 0) return null;
      const entity = decode(index);
      cachedIds[slot] = id;
      cached[slot] = entity;
      return entity;
    },
    indexIds: Float64Array.from(indexIds),
    otherIds: Float64Array.from(otherIds),
    position: (id) => {
      const [index] = ids.idOrIndex({ id });
      return index >= 0 ? index : undefined;
    },
    patchSize: entities.size,
  };
}

/** The patch's layers over `base`, by entity type. */
export function patchLayers(base: Osm, patch: Osm) {
  return {
    node: layerOf("node", base, patch),
    way: layerOf("way", base, patch),
    relation: layerOf("relation", base, patch),
  };
}
