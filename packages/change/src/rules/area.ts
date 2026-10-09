/** Which ways are areas. Two predicates remain; see gap G2 in docs/merge-process.md. */
import type { OsmTags, OsmWay } from "@osmix/types";

export function isAreaWay(way: OsmWay) {
  if (String(way.tags?.["area"] ?? "") === "yes") return true;
  if (way.refs.length < 4 || way.refs[0] !== way.refs.at(-1)) return false;
  return ["building", "landuse", "natural", "boundary"].some((key) => way.tags?.[key] != null);
}

export const isPolygonish = (t: OsmTags) => !!(t["building"] || t["landuse"] || t["natural"]);
