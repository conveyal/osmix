import type { Osm, OsmEntityType } from "osmix";
import type { OsmEntity } from "osmix";

export function getOsmixEntityByStringId(osm: Osm, eid: string): OsmEntity | null {
  const [type, sid] = eid.split("/");
  const id = Number(sid);
  switch (type) {
    case "node":
      return osm.nodes.get({ id });
    case "way":
      return osm.ways.get({ id });
    case "relation":
      return osm.relations.get({ id });
    default:
      return null;
  }
}

/** A search query that names one entity: `node/123`, `way 123`, `relation/-5`, `n123`. */
export interface EntityQuery {
  type: OsmEntityType;
  id: number;
}

const ENTITY_TYPES: Record<string, OsmEntityType> = {
  n: "node",
  node: "node",
  w: "way",
  way: "way",
  r: "relation",
  relation: "relation",
};

const ENTITY_QUERY = /^(node|way|relation|n|w|r)(?:\s*\/\s*|\s+|)(-?\d+)$/i;

/**
 * Read an entity reference out of a search query. Accepts the full type or its initial,
 * case-insensitively, followed by an optional slash or whitespace and the id (negative ids are
 * allowed; they name entities created in a patch). Anything else is a place query: `null`.
 */
export function parseEntityQuery(query: string): EntityQuery | null {
  const match = ENTITY_QUERY.exec(query.trim());
  if (!match) return null;
  const type = ENTITY_TYPES[match[1]!.toLowerCase()];
  if (!type) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id)) return null;
  return { type, id };
}
