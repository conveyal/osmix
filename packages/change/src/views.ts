/**
 * Read-only views of one side of a merge (the base, or the imported data). Matching reads
 * through these instead of a concrete `Osm`, so the planner can hand it a view of the planned
 * state filtered by provenance instead of the untouched inputs.
 */
import type { Osm } from "@osmix/core";
import type { LonLat, OsmNode, OsmRelation, OsmWay } from "@osmix/types";

/** Which nodes and ways relations name, and which of those are turn restrictions. */
export type EntityRelationContext = {
  nodes: Set<number>;
  ways: Set<number>;
  restrictionNodes: Set<number>;
  restrictionWays: Set<number>;
};

/** Entity lookups and iteration: what an `Osm` table offers, readable from a plan too. */
export interface EntityReader<T> extends Iterable<T> {
  getById(id: number): T | null | undefined;
  ids: { has(id: number): boolean };
}

/** A dataset read by ID, without spatial indexes. An `Osm` is one; so is a plan's state. */
export interface DatasetReader {
  readonly id: string;
  readonly nodes: EntityReader<OsmNode>;
  readonly ways: EntityReader<OsmWay>;
  readonly relations: EntityReader<OsmRelation>;
}

export interface DatasetView {
  readonly id: string;
  /** Nodes in ascending ID order. */
  nodes(): Iterable<OsmNode>;
  /** Ways in ascending ID order. */
  ways(): Iterable<OsmWay>;
  getNode(id: number): OsmNode | null;
  getWay(id: number): OsmWay | null;
  /** A way's coordinates, skipping refs this side cannot resolve. */
  wayCoordinates(way: OsmWay): LonLat[];
  /** Nodes within `meters` of a point, nearest first. */
  nodesWithinRadius(lon: number, lat: number, meters: number): OsmNode[];
  /** Ways whose bounding box intersects `bbox`. */
  waysIntersecting(bbox: [number, number, number, number]): OsmWay[];
  /** Ways that reference a node. */
  waysAtNode(nodeId: number): readonly OsmWay[];
  relationMembership(): EntityRelationContext;
  /** Relations in ascending ID order. */
  relations(): Iterable<OsmRelation>;
}

/** A view of one complete, indexed `Osm`. Incidence and membership are built on first use. */
export function osmDatasetView(osm: Osm): DatasetView {
  let incidence: Map<number, OsmWay[]> | undefined;
  let membership: EntityRelationContext | undefined;
  return {
    id: osm.id,
    nodes: () => osm.nodes.sorted(),
    ways: () => osm.ways.sorted(),
    relations: () => osm.relations.sorted(),
    getNode: (id) => osm.nodes.getById(id),
    getWay: (id) => osm.ways.getById(id),
    wayCoordinates(way) {
      const index = osm.ways.ids.getIndexFromId(way.id);
      return index < 0 ? [] : osm.ways.getResolvedCoordinates(index);
    },
    nodesWithinRadius: (lon, lat, meters) =>
      osm.nodes
        .findIndexesWithinRadius(lon, lat, meters / 1_000)
        .map((index) => osm.nodes.getByIndex(index)),
    waysIntersecting: (bbox) =>
      osm.ways.intersects(bbox).map((index) => osm.ways.getByIndex(index)),
    waysAtNode(nodeId) {
      if (!incidence) {
        incidence = new Map();
        for (const way of osm.ways) {
          for (const ref of new Set(way.refs)) {
            const ways = incidence.get(ref) ?? [];
            ways.push(way);
            incidence.set(ref, ways);
          }
        }
      }
      return incidence.get(nodeId) ?? [];
    },
    relationMembership() {
      if (membership) return membership;
      membership = {
        nodes: new Set(),
        ways: new Set(),
        restrictionNodes: new Set(),
        restrictionWays: new Set(),
      };
      for (const relation of osm.relations) {
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
