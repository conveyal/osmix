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

/** Routing graph built from OSM ways and nodes. */
export interface RoutingGraph {
	/** Adjacency list: node index -> outgoing edges */
	readonly edges: Map<number, GraphEdge[]>
	/** Nodes where multiple ways meet (for turn detection) */
	readonly intersections: Set<number>
	/** Check if node is part of the routable network. */
	isRouteable: (nodeIndex: number) => boolean
	/** Check if node is an intersection (multiple ways meet). */
	isIntersection: (nodeIndex: number) => boolean
	/** Get outgoing edges from a node. */
	getEdges: (nodeIndex: number) => GraphEdge[]
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
