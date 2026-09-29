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
} from "@osmix/router";

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

/** CAR and WALK topology of the base and of the planned result. */
export function planRoutingDiagnostics(base: Osm, overlay: PlanOverlay) {
  const baseSource = { nodeCount: base.nodes.size, ways: () => base.ways };
  const plannedSource = { nodeCount: overlay.nodeCount, ways: () => overlay.ways() };
  return {
    car: delta(
      routingTopologyStats(baseSource, defaultHighwayFilter),
      routingTopologyStats(plannedSource, defaultHighwayFilter),
    ),
    walk: delta(
      routingTopologyStats(baseSource, walkFilter),
      routingTopologyStats(plannedSource, walkFilter),
    ),
  };
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
