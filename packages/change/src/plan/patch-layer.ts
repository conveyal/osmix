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
  for (let index = 0; index < entities.size; index++) {
    const id = ids.at(index);
    if (baseIds.has(id)) continue;
    if (Number.isInteger(id) && id >= 0 && id <= MAX_INDEX_KEY) indexIds.push(id);
    else otherIds.push(id);
  }
  indexIds.sort((a, b) => a - b);
  const has = (id: number) => ids.has(id) && !baseIds.has(id);
  return {
    osmId: patch.id,
    has,
    get: (id) => {
      if (!has(id)) return null;
      const entity = entities.getById(id) as OsmEntityTypeMap[T] | null;
      if (!entity || type !== "way") return entity;
      return removeDuplicateAdjacentWayRefs(
        entity as OsmEntityTypeMap["way"],
      ) as OsmEntityTypeMap[T];
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
