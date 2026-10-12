/**
 * Routing graph construction from OSM data.
 *
 * Builds a directed graph from OSM ways suitable for pathfinding. Edges are
 * created between consecutive nodes in each way, with pre-computed distance
 * and time costs. Respects one-way restrictions.
 *
 * Uses CSR (Compressed Sparse Row) format for efficient storage and
 * zero-copy transfer between workers via SharedArrayBuffer.
 *
 * @module
 */

import { BufferConstructor, type BufferType, type Osm } from "@osmix/core";
import { haversineDistance } from "@osmix/geo/haversine-distance";
import { BitSet } from "@osmix/shared/bit-set";
import type { LonLat } from "@osmix/types";
import { normalizedWayDirection } from "@osmix/types/way-direction";

import type {
  DefaultSpeeds,
  GraphEdge,
  HighwayFilter,
  RoutingGraphTransferables,
} from "./types.ts";
import { DEFAULT_SPEEDS, defaultHighwayFilter, getSpeedLimit } from "./utils.ts";

/**
 * Routing graph built from OSM ways and nodes.
 *
 * Uses CSR (Compressed Sparse Row) format internally for memory efficiency
 * and zero-copy transfer between workers.
 *
 * @example Build from OSM data
 * ```ts
 * const graph = new RoutingGraph(osm)
 * const router = new Router(osm, graph)
 * const path = router.route(startNodeIndex, endNodeIndex)
 * ```
 *
 * @example Transfer between workers
 * ```ts
 * // In source worker
 * const buffers = graph.transferables()
 * Comlink.transfer(buffers, getTransferableBuffers(buffers))
 *
 * // In target worker
 * const graph = new RoutingGraph(buffers)
 * ```
 */
export class RoutingGraph {
  /** Total number of nodes in the source OSM data. */
  private nodeCount = 0;
  /** Total number of edges in the graph. */
  private edgeCount = 0;

  // CSR format arrays (populated after compact())
  private edgeOffsets: Uint32Array | null = null;
  private edgeTargets: Uint32Array | null = null;
  private edgeWayIndexes: Uint32Array | null = null;
  private edgeDistances: Float32Array | null = null;
  private edgeTimes: Float32Array | null = null;
  private routable: BitSet | null = null;
  private intersections: BitSet | null = null;

  // Incoming-edge CSR, built on first use by getIncomingEdges(). Per worker; not transferred.
  private reverseOffsets: Uint32Array | null = null;
  /** Forward edge index for each incoming edge, grouped by target node. */
  private reverseEdges: Uint32Array | null = null;
  private reverseSources: Uint32Array | null = null;
  private cachedMaxSpeedMps: number | null = null;

  // Expose highway filter and default speeds
  readonly filter: HighwayFilter;
  readonly defaultSpeeds: DefaultSpeeds;

  /**
   * Create a RoutingGraph.
   *
   * @param source - Either an Osm instance to build from, or RoutingGraphTransferables to reconstruct.
   * @param filter - Function to determine which ways are routable (only used when building from Osm).
   * @param defaultSpeeds - Speed limits by highway type (only used when building from Osm).
   */
  constructor(
    source: Osm | RoutingGraphTransferables,
    filter: HighwayFilter = defaultHighwayFilter,
    defaultSpeeds: DefaultSpeeds = DEFAULT_SPEEDS,
  ) {
    this.filter = filter;
    this.defaultSpeeds = defaultSpeeds;
    if ("nodeCount" in source) {
      // Reconstruct from transferables
      this.fromTransferables(source);
    } else {
      // Build from OSM data
      this.buildFromOsm(source, filter, defaultSpeeds);
    }
  }

  /**
   * Reconstruct from transferables (worker transfer).
   */
  private fromTransferables(t: RoutingGraphTransferables) {
    this.nodeCount = t.nodeCount;
    this.edgeCount = t.edgeCount;
    this.edgeOffsets = new Uint32Array(t.edgeOffsets);
    this.edgeTargets = new Uint32Array(t.edgeTargets);
    this.edgeWayIndexes = new Uint32Array(t.edgeWayIndexes);
    this.edgeDistances = new Float32Array(t.edgeDistances);
    this.edgeTimes = new Float32Array(t.edgeTimes);
    this.routable = new BitSet(t.nodeCount, t.routableBits);
    this.intersections = new BitSet(t.nodeCount, t.intersectionBits);
  }

  /**
   * Build the graph from OSM data in two passes over the routable ways, straight into typed
   * arrays: the first counts each node's outgoing edges and sets the node flags, the second
   * fills the CSR arrays. No per-edge objects or `Map`/`Set` (V8 caps those near 2^24 entries).
   */
  private buildFromOsm(osm: Osm, filter: HighwayFilter, defaultSpeeds: DefaultSpeeds) {
    this.nodeCount = osm.nodes.size;
    const bitsetLength = BitSet.byteLength(this.nodeCount);
    this.routable = new BitSet(this.nodeCount, new BufferConstructor(bitsetLength));
    this.intersections = new BitSet(this.nodeCount, new BufferConstructor(bitsetLength));
    const offsets = new Uint32Array(
      new BufferConstructor((this.nodeCount + 1) * Uint32Array.BYTES_PER_ELEMENT),
    );
    this.edgeOffsets = offsets;

    // Pass 1: count outgoing edges into offsets[from + 1], and mark routable nodes and
    // intersections (a node seen a second time).
    this.forEachSegment(osm, filter, defaultSpeeds, (from, to, direction) => {
      if (direction !== "reverse") offsets[from + 1]!++;
      if (direction !== "forward") offsets[to + 1]!++;
      this.markRoutable(from);
      this.markRoutable(to);
    });
    for (let n = 0; n < this.nodeCount; n++) offsets[n + 1]! += offsets[n]!;
    this.edgeCount = offsets[this.nodeCount]!;

    this.edgeTargets = new Uint32Array(
      new BufferConstructor(this.edgeCount * Uint32Array.BYTES_PER_ELEMENT),
    );
    this.edgeWayIndexes = new Uint32Array(
      new BufferConstructor(this.edgeCount * Uint32Array.BYTES_PER_ELEMENT),
    );
    this.edgeDistances = new Float32Array(
      new BufferConstructor(this.edgeCount * Float32Array.BYTES_PER_ELEMENT),
    );
    this.edgeTimes = new Float32Array(
      new BufferConstructor(this.edgeCount * Float32Array.BYTES_PER_ELEMENT),
    );

    // Pass 2: fill each node's edges in way order.
    const cursor = offsets.slice(0, this.nodeCount);
    const addEdge = (
      from: number,
      to: number,
      wayIndex: number,
      distance: number,
      time: number,
    ) => {
      const edgeIndex = cursor[from]!++;
      this.edgeTargets![edgeIndex] = to;
      this.edgeWayIndexes![edgeIndex] = wayIndex;
      this.edgeDistances![edgeIndex] = distance;
      this.edgeTimes![edgeIndex] = time;
    };
    this.forEachSegment(osm, filter, defaultSpeeds, (from, to, direction, wayIndex, speedMps) => {
      const distance = haversineDistance(
        osm.nodes.getNodeLonLat({ index: from }),
        osm.nodes.getNodeLonLat({ index: to }),
      );
      const time = distance / speedMps;
      if (direction !== "reverse") addEdge(from, to, wayIndex, distance, time);
      if (direction !== "forward") addEdge(to, from, wayIndex, distance, time);
    });
  }

  /** Visit each segment of each routable way, in way order, with its direction and speed. */
  private forEachSegment(
    osm: Osm,
    filter: HighwayFilter,
    defaultSpeeds: DefaultSpeeds,
    visit: (
      from: number,
      to: number,
      direction: "forward" | "reverse" | "both",
      wayIndex: number,
      speedMps: number,
    ) => void,
  ) {
    for (let wayIndex = 0; wayIndex < osm.ways.size; wayIndex++) {
      const tags = osm.ways.tags.getTags(wayIndex);
      if (!filter(tags)) continue;

      const refs = osm.ways.getRefIds(wayIndex);
      if (refs.length < 2) continue;

      const normalizedDirection = normalizedWayDirection(tags);
      // Preserve the existing router approximation for unsupported dynamic values.
      // Matching does not use this fallback to establish direction equivalence.
      const direction =
        normalizedDirection === "unsupported"
          ? tags?.["junction"] === "roundabout"
            ? "forward"
            : "both"
          : normalizedDirection;
      const speedMps = (getSpeedLimit(tags, defaultSpeeds) * 1_000) / 60 / 60;

      let from = osm.nodes.ids.getIndexFromId(refs[0]!);
      for (let i = 1; i < refs.length; i++) {
        const to = osm.nodes.ids.getIndexFromId(refs[i]!);
        // A ref to a node outside the dataset (for example, cut off by an extract) has index -1.
        // Skip the segments that touch it rather than store a wrapped Uint32 index.
        if (from >= 0 && to >= 0) visit(from, to, direction, wayIndex, speedMps);
        from = to;
      }
    }
  }

  /** Mark a node routable, or an intersection if it was already routable. */
  private markRoutable(nodeIndex: number) {
    // Segment endpoints are resolved node indexes, so they are in range.
    if (this.routable!.hasUnchecked(nodeIndex)) this.intersections!.addUnchecked(nodeIndex);
    else this.routable!.addUnchecked(nodeIndex);
  }

  /**
   * Check if a node is part of the routable network.
   */
  isRoutable(nodeIndex: number): boolean {
    if (nodeIndex < 0 || nodeIndex >= this.nodeCount) return false;
    return this.routable!.hasUnchecked(nodeIndex);
  }

  /**
   * Check if a node is an intersection (multiple ways meet).
   */
  isIntersection(nodeIndex: number): boolean {
    if (nodeIndex < 0 || nodeIndex >= this.nodeCount) return false;
    return this.intersections!.hasUnchecked(nodeIndex);
  }

  /**
   * Get outgoing edges from a node.
   */
  getEdges(nodeIndex: number): GraphEdge[] {
    if (nodeIndex < 0 || nodeIndex >= this.nodeCount || !this.edgeOffsets || !this.edgeTargets) {
      return [];
    }

    const start = this.edgeOffsets[nodeIndex]!;
    const end = this.edgeOffsets[nodeIndex + 1]!;
    const edges: GraphEdge[] = [];

    for (let i = start; i < end; i++) {
      edges.push({
        targetNodeIndex: this.edgeTargets[i]!,
        wayIndex: this.edgeWayIndexes![i]!,
        distance: this.edgeDistances![i]!,
        time: this.edgeTimes![i]!,
      });
    }

    return edges;
  }

  /**
   * Get incoming edges of a node. In each returned edge, `targetNodeIndex` is the
   * edge's source node. The reverse index (4 bytes per node plus 8 bytes per edge)
   * is built on the first call.
   */
  getIncomingEdges(nodeIndex: number): GraphEdge[] {
    if (nodeIndex < 0 || nodeIndex >= this.nodeCount || !this.edgeOffsets || !this.edgeTargets) {
      return [];
    }
    if (!this.reverseOffsets) this.buildReverseIndex();
    const start = this.reverseOffsets![nodeIndex]!;
    const end = this.reverseOffsets![nodeIndex + 1]!;
    const edges: GraphEdge[] = [];
    for (let i = start; i < end; i++) {
      const edgeIndex = this.reverseEdges![i]!;
      edges.push({
        targetNodeIndex: this.reverseSources![i]!,
        wayIndex: this.edgeWayIndexes![edgeIndex]!,
        distance: this.edgeDistances![edgeIndex]!,
        time: this.edgeTimes![edgeIndex]!,
      });
    }
    return edges;
  }

  private buildReverseIndex() {
    const offsets = this.edgeOffsets!;
    const targets = this.edgeTargets!;
    const reverseOffsets = new Uint32Array(this.nodeCount + 1);
    for (let i = 0; i < this.edgeCount; i++) reverseOffsets[targets[i]! + 1]!++;
    for (let n = 0; n < this.nodeCount; n++) {
      reverseOffsets[n + 1]! += reverseOffsets[n]!;
    }
    const cursor = reverseOffsets.slice(0, this.nodeCount);
    const reverseEdges = new Uint32Array(this.edgeCount);
    const reverseSources = new Uint32Array(this.edgeCount);
    for (let source = 0; source < this.nodeCount; source++) {
      for (let e = offsets[source]!; e < offsets[source + 1]!; e++) {
        const slot = cursor[targets[e]!]!++;
        reverseEdges[slot] = e;
        reverseSources[slot] = source;
      }
    }
    this.reverseOffsets = reverseOffsets;
    this.reverseEdges = reverseEdges;
    this.reverseSources = reverseSources;
  }

  /**
   * Fastest edge speed in the graph, in meters per second. The A* time heuristic
   * divides by this so that it never overestimates travel time.
   */
  get maxSpeedMps(): number {
    if (this.cachedMaxSpeedMps !== null) return this.cachedMaxSpeedMps;
    let max = 0;
    for (let i = 0; i < this.edgeCount; i++) {
      const time = this.edgeTimes![i]!;
      if (time > 0) max = Math.max(max, this.edgeDistances![i]! / time);
    }
    // Float32 rounding can shave a little off the true speed; keep the bound safe.
    this.cachedMaxSpeedMps = max > 0 ? max * (1 + 1e-6) : Number.POSITIVE_INFINITY;
    return this.cachedMaxSpeedMps;
  }

  /**
   * Get transferable buffers for passing to another thread.
   */
  transferables(): RoutingGraphTransferables {
    return {
      nodeCount: this.nodeCount,
      edgeCount: this.edgeCount,
      edgeOffsets: this.edgeOffsets!.buffer as BufferType,
      edgeTargets: this.edgeTargets!.buffer as BufferType,
      edgeWayIndexes: this.edgeWayIndexes!.buffer as BufferType,
      edgeDistances: this.edgeDistances!.buffer as BufferType,
      edgeTimes: this.edgeTimes!.buffer as BufferType,
      routableBits: this.routable!.buffer as BufferType,
      intersectionBits: this.intersections!.buffer as BufferType,
    };
  }

  /**
   * Number of node slots in the graph: every node in the source OSM data, not only
   * routable ones. Use `isRoutable()` to test a node.
   */
  get size(): number {
    return this.nodeCount;
  }

  /**
   * Get the number of edges in the graph.
   */
  get edges(): number {
    return this.edgeCount;
  }

  /**
   * Find the nearest routable OSM node from a geographic point.
   *
   * Searches for nodes within the given radius that are part of the routing
   * graph (i.e., lie on a routable way). Returns the closest match with its
   * coordinates and distance.
   *
   * Snaps to graph nodes only, not to points along edges. Requires the "all" node
   * spatial index; throws `SpatialIndexNotBuiltError` without it.
   *
   * @param osm - The OSM dataset.
   * @param point - The [lon, lat] coordinates to search from.
   * @param maxDistanceM - Maximum search radius in meters.
   * @returns The nearest routable node, or null if none found.
   *
   * @example
   * ```ts
   * const nearest = graph.findNearestRoutableNode(osm, [-73.989, 40.733], 500)
   * if (nearest) {
   *   console.log(`Found node ${nearest.nodeIndex} at ${nearest.distance}m`)
   * }
   * ```
   */
  findNearestRoutableNode(osm: Osm, point: LonLat, maxDistanceM: number) {
    const nearby = osm.nodes.findIndexesWithinRadius(point[0], point[1], maxDistanceM / 1_000);

    let best: {
      nodeIndex: number;
      coordinates: LonLat;
      distance: number;
    } | null = null;
    let bestDistM = Number.POSITIVE_INFINITY;

    for (const nodeIndex of nearby) {
      if (!this.isRoutable(nodeIndex)) continue;

      const nodeCoord = osm.nodes.getNodeLonLat({ index: nodeIndex });
      const distance = haversineDistance(point, nodeCoord);
      if (distance < bestDistM && distance <= maxDistanceM) {
        bestDistM = distance;
        best = { nodeIndex, coordinates: nodeCoord, distance };
      }
    }

    return best;
  }
}

/**
 * Build a routing graph from OSM ways.
 *
 * Convenience function that creates a RoutingGraph.
 *
 * @param osm - The OSM dataset to build from.
 * @param filter - Function to determine which ways are routable.
 * @param defaultSpeeds - Speed limits (km/h) by highway type.
 * @returns A RoutingGraph ready for pathfinding.
 */
export function buildGraph(
  osm: Osm,
  filter: HighwayFilter = defaultHighwayFilter,
  defaultSpeeds: DefaultSpeeds = DEFAULT_SPEEDS,
): RoutingGraph {
  return new RoutingGraph(osm, filter, defaultSpeeds);
}

/**
 * Get an array of buffers suitable for Comlink.transfer() or postMessage transfer list.
 * Note: SharedArrayBuffers don't need to be transferred (they're shared automatically),
 * but ArrayBuffers do. This returns only the ArrayBuffers that need explicit transfer.
 */
export function getTransferableBuffers(t: RoutingGraphTransferables): ArrayBuffer[] {
  const buffers = [
    t.edgeOffsets,
    t.edgeTargets,
    t.edgeWayIndexes,
    t.edgeDistances,
    t.edgeTimes,
    t.routableBits,
    t.intersectionBits,
  ];
  // Only ArrayBuffers need to be transferred; SharedArrayBuffers are shared automatically
  return buffers.filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
}
