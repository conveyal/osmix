/**
 * Type definitions for the routing module.
 * @module
 */

import type { BufferType } from "@osmix/core"
import type { LonLat, OsmTags } from "@osmix/shared/types"

/** Per-way segment with distance and time (consecutive same-name ways merged). */
export interface WaySegment {
	/** OSM way IDs included in this segment (multiple if merged). */
	wayIds: number[]
	/** Way name from tags (may be empty). */
	name: string
	/** Highway type from tags. */
	highway: string
	/** Distance travelled on this segment in meters. */
	distance: number
	/** Time travelled on this segment in seconds. */
	time: number
}

/** Route statistics (distance and time). */
export interface RouteStatistics {
	/** Total route distance in meters. */
	distance: number
	/** Total route time in seconds. */
	time: number
}

/** Route path info (segments and turn points). */
export interface RoutePathInfo {
	/** Per-way breakdown (consecutive same-name ways merged). */
	segments: WaySegment[]
	/** Coordinates where way name changes (turn points). */
	turnPoints: LonLat[]
}

/** Route result containing the path geometry and metadata. */
export interface RouteResult {
	/** Coordinates along the route. */
	coordinates: LonLat[]
	/** Way indexes traversed, in order. */
	wayIndexes: number[]
	/** Node indexes at turns and intersections. */
	nodeIndexes: number[]
	/** Total route distance in meters (when includeStats is true). */
	distance?: number
	/** Total route time in seconds (when includeStats is true). */
	time?: number
	/** Per-way breakdown (when includePathInfo is true). */
	segments?: WaySegment[]
	/** Coordinates where way name changes (when includePathInfo is true). */
	turnPoints?: LonLat[]
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
	/** Include distance and time in result. Default: false. */
	includeStats?: boolean
	/** Include segments and turnPoints in result. Default: false. */
	includePathInfo?: boolean
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
