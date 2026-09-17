import type { Osm } from "osmix";
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
