/**
 * Checks a plan runs once every phase has recorded its changes: routing topology before and
 * after, new routing-integrity problems, and the drivable-network rule for automatic
 * connections. None of them builds the planned dataset.
 */
import type { Osm } from "@osmix/core";
import {
  defaultHighwayFilter,
  defaultPedestrianFilter,
  type HighwayFilter,
  type RoutingTopologyStats,
  routingTopologyStats,
  routingWayEdges,
} from "@osmix/router";
import type { OsmWay } from "@osmix/types";

import type { OsmConflationCandidate, OsmConflationDiscovery } from "../types.ts";
import type { PlanOverlay } from "./overlay.ts";
import type { PlanRoutingDelta } from "./types.ts";

const walkFilter: HighwayFilter = (tags) =>
  defaultHighwayFilter(tags) || defaultPedestrianFilter(tags);

function delta(before: RoutingTopologyStats, after: RoutingTopologyStats): PlanRoutingDelta {
  return {
    before,
    after,
    delta: {
      nodes: after.nodes - before.nodes,
      routableNodes: after.routableNodes - before.routableNodes,
      edges: after.edges - before.edges,
      components: after.components - before.components,
    },
  };
}

/** CAR and WALK topology of a dataset that does not change, computed once per plan. */
export interface BaseRoutingStats {
  car: RoutingTopologyStats;
  walk: RoutingTopologyStats;
}

export function baseRoutingStats(base: Osm): BaseRoutingStats {
  const source = { nodeCount: base.nodes.size, ways: () => base.ways };
  return {
    car: routingTopologyStats(source, defaultHighwayFilter),
    walk: routingTopologyStats(source, walkFilter),
  };
}

/** CAR and WALK topology of the base (computed once) and of the planned result. */
export function planRoutingDiagnostics(
  baseStats: BaseRoutingStats,
  planned: PlannedRoutingStats,
  overlay: PlanOverlay,
) {
  const after = planned.stats(overlay);
  return { car: delta(baseStats.car, after.car), walk: delta(baseStats.walk, after.walk) };
}

/** The base's network without some of its ways, as union-find roots, for one filter. */
interface BasePart {
  /** Each routable node's component root. */
  rootOf: Map<number, number>;
  edges: number;
  components: number;
}

/**
 * The planned result's CAR and WALK topology, kept proportional to the plan's changes. The
 * base's network without the base ways the plan changed is computed once; each check adds the
 * current versions of those ways and the created ways. A union cannot be undone, so the ways
 * left out only grow: when the plan changes another base way, the base part is rebuilt.
 * Results equal `routingTopologyStats` over the planned state.
 */
export class PlannedRoutingStats {
  private readonly base: Osm;
  private readonly excluded = new Set<number>();
  private parts: { car: BasePart; walk: BasePart } | undefined;

  /** `likelyChanged`: base ways decisions may change, left out from the start (any superset is exact). */
  constructor(base: Osm, likelyChanged: Iterable<number> = []) {
    this.base = base;
    for (const id of likelyChanged) if (base.ways.ids.has(id)) this.excluded.add(id);
  }

  stats(overlay: PlanOverlay): { car: RoutingTopologyStats; walk: RoutingTopologyStats } {
    const created: OsmWay[] = [];
    let grew = false;
    for (const key of Object.keys(overlay.wayChanges)) {
      const id = Number(key);
      const change = overlay.wayChanges[id];
      if (!change) continue;
      if (this.base.ways.ids.has(id)) {
        if (!this.excluded.has(id)) {
          this.excluded.add(id);
          grew = true;
        }
      } else if (change.changeType !== "delete") created.push(change.entity);
    }
    if (grew || !this.parts) {
      this.parts = {
        car: this.basePart(defaultHighwayFilter),
        walk: this.basePart(walkFilter),
      };
    }
    const added: OsmWay[] = [...created];
    for (const id of this.excluded) {
      const way = overlay.getWay(id);
      if (way) added.push(way);
    }
    return {
      car: withWays(this.parts.car, added, defaultHighwayFilter, overlay.nodeCount),
      walk: withWays(this.parts.walk, added, walkFilter, overlay.nodeCount),
    };
  }

  private basePart(filter: HighwayFilter): BasePart {
    const parent = new Map<number, number>();
    const find = unionFind(parent);
    let edges = 0;
    for (const way of this.base.ways) {
      if (this.excluded.has(way.id)) continue;
      const wayEdges = routingWayEdges(way, filter);
      if (wayEdges == null) continue;
      edges += wayEdges;
      for (let index = 0; index < way.refs.length - 1; index++) {
        find.union(way.refs[index]!, way.refs[index + 1]!);
      }
    }
    const rootOf = new Map<number, number>();
    const roots = new Set<number>();
    for (const id of parent.keys()) {
      const root = find.find(id);
      rootOf.set(id, root);
      roots.add(root);
    }
    return { rootOf, edges, components: roots.size };
  }
}

/** The base part's counts with `ways` added. */
function withWays(
  part: BasePart,
  ways: readonly OsmWay[],
  filter: HighwayFilter,
  nodeCount: number,
): RoutingTopologyStats {
  // Union base components (by root) and new nodes; each successful union joins two components.
  const parent = new Map<number, number>();
  const find = unionFind(parent);
  const newNodes = new Set<number>();
  let edges = part.edges;
  let joins = 0;
  const representative = (id: number) => {
    const root = part.rootOf.get(id);
    if (root != null) return root;
    newNodes.add(id);
    return id;
  };
  for (const way of ways) {
    const wayEdges = routingWayEdges(way, filter);
    if (wayEdges == null) continue;
    edges += wayEdges;
    for (let index = 0; index < way.refs.length - 1; index++) {
      if (find.union(representative(way.refs[index]!), representative(way.refs[index + 1]!))) {
        joins++;
      }
    }
  }
  return {
    nodes: nodeCount,
    routableNodes: part.rootOf.size + newNodes.size,
    edges,
    components: part.components + newNodes.size - joins,
  };
}

function unionFind(parent: Map<number, number>) {
  const find = (id: number): number => {
    if (!parent.has(id)) parent.set(id, id);
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
  /** Join two sets; true when they were apart. */
  const union = (a: number, b: number) => {
    const left = find(a);
    const right = find(b);
    if (left === right) return false;
    parent.set(right, left);
    return true;
  };
  return { find, union };
}

/**
 * Automatic matching never changes the drivable network. A connection changes it exactly when
 * it rewrites an imported way the car router uses, so such a connection needs review instead.
 * Returns the demoted candidates.
 */
export function demoteDrivableConnections(
  discovery: OsmConflationDiscovery,
  overlay: PlanOverlay,
): OsmConflationCandidate[] {
  const demoted: OsmConflationCandidate[] = [];
  for (const candidate of discovery.candidates) {
    const attachment = candidate.networkAttachment;
    if (attachment?.status !== "automatic") continue;
    const drivable = (candidate.evidence.patchWayIds ?? []).some((id) =>
      defaultHighwayFilter(overlay.getWay(id)?.tags),
    );
    if (!drivable) continue;
    candidate.networkAttachment = {
      status: "review",
      reasons: [...new Set([...attachment.reasons, "drivable-network" as const])],
    };
    if (candidate.status === "automatic") candidate.status = "review";
    candidate.reasons = [...new Set([...candidate.reasons, "drivable-network" as const])];
    demoted.push(candidate);
  }
  return demoted;
}
