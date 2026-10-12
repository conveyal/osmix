/**
 * Matching reads the planned state, one side at a time. The base side lists base entities in
 * their planned version; the imported side lists patch entities that earlier phases kept, so a
 * point already merged into the base is not matched again. Both sides resolve any current node,
 * so an imported way that now ends on a base point keeps its geometry.
 */
import type { Osm } from "@osmix/core";
import type { OsmEntityType, OsmRelation, OsmWay } from "@osmix/types";

import type { MergeProvenance } from "../provenance.ts";
import type { DatasetView, EntityRelationContext } from "../views.ts";
import type { PlanOverlay } from "./overlay.ts";

/**
 * A view of one side of the planned state. `listed` is the input whose IDs make up the side,
 * enumerated in ascending ID order; `member` decides which current entities belong to it.
 */
function plannedSideView(
  overlay: PlanOverlay,
  listed: Osm,
  member: (type: OsmEntityType, id: number) => boolean,
): DatasetView {
  let membership: EntityRelationContext | undefined;
  const current = <T>(ids: Iterable<{ id: number }>, get: (id: number) => T | null) => {
    const entities: T[] = [];
    for (const { id } of ids) {
      const entity = get(id);
      if (entity) entities.push(entity);
    }
    return entities;
  };
  const relations = (): OsmRelation[] =>
    current(listed.relations.sorted(), (id) => overlay.getRelation(id));
  return {
    id: listed.id,
    nodes: () => current(listed.nodes.sorted(), (id) => overlay.getNode(id)),
    ways: () => current(listed.ways.sorted(), (id) => overlay.getWay(id)),
    relations,
    getNode: (id) => overlay.getNode(id),
    getWay: (id) => (member("way", id) ? overlay.getWay(id) : null),
    wayCoordinates(way) {
      const coordinates = overlay.wayCoordinates(way);
      if (coordinates) return coordinates;
      return way.refs.flatMap((ref) => {
        const node = overlay.getNode(ref);
        return node ? [[node.lon, node.lat] as [number, number]] : [];
      });
    },
    nodesWithinRadius: (lon, lat, meters) =>
      overlay.nodesWithinRadius(lon, lat, meters).filter((node) => member("node", node.id)),
    waysIntersecting: (bbox) =>
      overlay.waysIntersecting(bbox).filter((way: OsmWay) => member("way", way.id)),
    waysAtNode: (nodeId) => overlay.waysAtNode(nodeId).filter((way) => member("way", way.id)),
    relationMembership() {
      if (membership) return membership;
      membership = {
        nodes: new Set(),
        ways: new Set(),
        restrictionNodes: new Set(),
        restrictionWays: new Set(),
      };
      for (const relation of relations()) {
        const restriction = relation.tags?.["type"] === "restriction";
        for (const member of relation.members) {
          if (member.type === "node") {
            membership.nodes.add(member.ref);
            if (restriction) membership.restrictionNodes.add(member.ref);
          } else if (member.type === "way") {
            membership.ways.add(member.ref);
            if (restriction) membership.restrictionWays.add(member.ref);
          }
        }
      }
      return membership;
    },
  };
}

/** Both sides of the planned state for matching. */
export function plannedMatchingViews(
  overlay: PlanOverlay,
  base: Osm,
  planned: Osm,
  provenance: MergeProvenance,
) {
  return {
    baseView: plannedSideView(overlay, base, (type, id) => provenance.isBase(type, id)),
    patchView: plannedSideView(overlay, planned, (type, id) => provenance.isPatch(type, id)),
  };
}
