import type { OsmTags } from "@osmix/types";
import { normalizedWayDirection } from "@osmix/types/way-direction";

import type { HighwayFilter } from "./types.ts";

/** Counts that describe a routing network's shape. */
export interface RoutingTopologyStats {
  /** Every node in the source, routable or not. */
  nodes: number;
  /** Nodes on at least one way the filter accepts. */
  routableNodes: number;
  /** Directed edges: two per segment, one for a one-way segment. */
  edges: number;
  /** Weakly connected components among routable nodes. */
  components: number;
}

/** Anything that can list its ways: an `Osm`, or a planner view of pending changes. */
export interface RoutingTopologySource {
  nodeCount: number;
  ways(): Iterable<{ tags?: OsmTags | undefined; refs: readonly number[] }>;
}

/**
 * The same counts `RoutingGraph` would give for `filter`, computed from ways alone, without
 * building the graph (no coordinates, speeds or CSR arrays). Direction follows the router: an
 * unsupported one-way value counts as forward on a roundabout and as two-way elsewhere.
 */
export function routingTopologyStats(
  source: RoutingTopologySource,
  filter: HighwayFilter,
): RoutingTopologyStats {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) !== cursor) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const left = find(a);
    const right = find(b);
    if (left !== right) parent.set(right, left);
  };
  let edges = 0;
  for (const way of source.ways()) {
    if (!filter(way.tags) || way.refs.length < 2) continue;
    const normalized = normalizedWayDirection(way.tags);
    const direction =
      normalized === "unsupported"
        ? way.tags?.["junction"] === "roundabout"
          ? "forward"
          : "both"
        : normalized;
    const perSegment = direction === "both" ? 2 : 1;
    for (let index = 0; index < way.refs.length - 1; index++) {
      union(way.refs[index]!, way.refs[index + 1]!);
      edges += perSegment;
    }
  }
  const roots = new Set<number>();
  for (const id of parent.keys()) roots.add(find(id));
  return { nodes: source.nodeCount, routableNodes: parent.size, edges, components: roots.size };
}
