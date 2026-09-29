/**
 * Bidirectional Dijkstra.
 *
 * Runs Dijkstra forward from the start over outgoing edges and backward from
 * the end over incoming edges, and stops when neither search can improve the
 * best meeting point. Returns an optimal path and respects one-way edges.
 *
 * @module
 */

import { BinaryHeap } from "../binary-heap.ts";
import type { GraphEdge, PathSegment, RoutingAlgorithmFn } from "../types.ts";

/** How the backward search reached a node: the next node toward the end. */
interface BackwardStep {
  nextNodeIndex: number;
  wayIndex: number;
}

/**
 * Bidirectional Dijkstra. Requires `context.reverseGraph`, which `Router`
 * supplies from `RoutingGraph.getIncomingEdges`.
 */
export const bidirectional: RoutingAlgorithmFn = (
  graph,
  start,
  end,
  getWeight,
  _getCoord,
  _metric,
  context,
) => {
  if (start === end) return [{ nodeIndex: start, cost: 0 }];
  const reverseGraph = context?.reverseGraph;
  if (!reverseGraph) {
    throw Error(
      "Bidirectional routing needs context.reverseGraph (incoming edges). " +
        "Router passes RoutingGraph.getIncomingEdges.",
    );
  }

  const fDist = new Map<number, number>([[start, 0]]);
  const bDist = new Map<number, number>([[end, 0]]);
  const fPrev = new Map<number, PathSegment>();
  const bNext = new Map<number, BackwardStep>();
  const fHeap = new BinaryHeap();
  const bHeap = new BinaryHeap();
  const fClosed = new Set<number>();
  const bClosed = new Set<number>();
  fHeap.push(start, 0);
  bHeap.push(end, 0);

  let best = Number.POSITIVE_INFINITY;
  let meet = -1;

  const relax = (
    current: number,
    edges: GraphEdge[],
    dist: Map<number, number>,
    otherDist: Map<number, number>,
    closed: Set<number>,
    heap: BinaryHeap,
    record: (neighbor: number, edge: GraphEdge, cost: number) => void,
  ) => {
    const currentD = dist.get(current)!;
    for (const edge of edges) {
      const neighbor = edge.targetNodeIndex;
      if (closed.has(neighbor)) continue;
      const cost = currentD + getWeight(edge);
      const existing = dist.get(neighbor);
      if (existing !== undefined && cost >= existing) continue;
      dist.set(neighbor, cost);
      record(neighbor, edge, cost);
      heap.push(neighbor, cost);
      const other = otherDist.get(neighbor);
      if (other !== undefined && cost + other < best) {
        best = cost + other;
        meet = neighbor;
      }
    }
  };

  while (fHeap.size > 0 && bHeap.size > 0) {
    // Stop once no unsettled node can lie on a path shorter than `best`.
    if (fHeap.peekPriority() + bHeap.peekPriority() >= best) break;

    if (fHeap.peekPriority() <= bHeap.peekPriority()) {
      const current = fHeap.pop()!;
      if (fClosed.has(current)) continue;
      fClosed.add(current);
      relax(current, graph(current), fDist, bDist, fClosed, fHeap, (neighbor, edge, cost) => {
        fPrev.set(neighbor, {
          nodeIndex: neighbor,
          wayIndex: edge.wayIndex,
          previousNodeIndex: current,
          cost,
        });
      });
    } else {
      const current = bHeap.pop()!;
      if (bClosed.has(current)) continue;
      bClosed.add(current);
      relax(current, reverseGraph(current), bDist, fDist, bClosed, bHeap, (neighbor, edge) => {
        bNext.set(neighbor, { nextNodeIndex: current, wayIndex: edge.wayIndex });
      });
    }
  }

  if (meet === -1) return null;

  // Forward half: start → meet.
  const path: PathSegment[] = [];
  let node = meet;
  while (node !== start) {
    const segment = fPrev.get(node)!;
    path.unshift(segment);
    node = segment.previousNodeIndex!;
  }
  path.unshift({ nodeIndex: start, cost: 0 });

  // Backward half: meet → end, with costs measured from the start.
  node = meet;
  while (node !== end) {
    const step = bNext.get(node)!;
    path.push({
      nodeIndex: step.nextNodeIndex,
      wayIndex: step.wayIndex,
      previousNodeIndex: node,
      cost: best - bDist.get(step.nextNodeIndex)!,
    });
    node = step.nextNodeIndex;
  }

  return path;
};
