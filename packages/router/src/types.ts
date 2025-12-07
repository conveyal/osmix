/**
 * Type definitions for the routing module.
 * @module
 */

import type { BufferType } from "@osmix/core"
import type { LonLat, OsmTags } from "@osmix/shared/types"

/** Route result containing the path geometry and metadata. */
export interface RouteResult {
	/** Coordinates along the route. */
	coordinates: LonLat[]
	/** Way indexes traversed, in order. */
	wayIndexes: number[]
	/** Node indexes at turns and intersections. */
	nodeIndexes: number[]
}

/** Filter function to determine which highways are routable. Default: common vehicle highways. */
export type HighwayFilter = (tags?: OsmTags) => boolean

/** Available routing algorithms. */
export type RoutingAlgorithm = "dijkstra" | "astar" | "bidirectional"

/** Routing metric to optimize. */
export type RoutingMetric = "distance" | "time"

/** Speed limits by highway type (km/h). */
export type DefaultSpeeds = Record<string, number>

/** Router configuration options. */
export interface RouteOptions {
	/** Routing algorithm. Default: "astar". */
	algorithm: RoutingAlgorithm
	/** Optimization metric. Default: "distance". */
	metric: RoutingMetric
}

/** Edge in the routing graph. */
export interface GraphEdge {
	/** Target node index. */
	targetNodeIndex: number
	/** Way index this edge belongs to. */
	wayIndex: number
	/** Distance in meters. */
	distance: number
	/** Travel time in seconds. */
	time: number
}

/**
 * Serializable representation of a RoutingGraph for worker transfer.
 * Uses CSR (Compressed Sparse Row) format for efficient storage and zero-copy transfer.
 */
export interface RoutingGraphTransferables {
	/** Total number of nodes in the graph. */
	nodeCount: number
	/** Total number of edges in the graph. */
	edgeCount: number
	/** CSR offsets: edges for node i are at indices [edgeOffsets[i], edgeOffsets[i+1]) */
	edgeOffsets: BufferType
	/** Target node index for each edge. */
	edgeTargets: BufferType
	/** Way index for each edge. */
	edgeWayIndexes: BufferType
	/** Distance in meters for each edge. */
	edgeDistances: BufferType
	/** Travel time in seconds for each edge. */
	edgeTimes: BufferType
	/** Bitset: 1 bit per node indicating if routable. */
	routableBits: BufferType
	/** Bitset: 1 bit per node indicating if intersection. */
	intersectionBits: BufferType
}

/** Path segment returned by routing algorithms. */
export interface PathSegment {
	/** Node index. */
	nodeIndex: number
	/** Way index used to reach this node. */
	wayIndex?: number
	/** Previous node in path. */
	previousNodeIndex?: number
	/** Cost to reach this node. */
	cost: number
}

/** Function signature for routing algorithms. */
export type RoutingAlgorithmFn = (
	graph: (nodeIndex: number) => GraphEdge[],
	startNodeIndex: number,
	endNodeIndex: number,
	getEdgeWeight: (edge: GraphEdge) => number,
	getNodeCoord?: (nodeIndex: number) => LonLat | undefined,
	metric?: RoutingMetric,
) => PathSegment[] | null
