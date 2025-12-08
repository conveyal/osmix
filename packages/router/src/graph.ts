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

import { BufferConstructor, type BufferType, type Osm } from "@osmix/core"
import { haversineDistance } from "@osmix/shared/haversine-distance"
import type { LonLat } from "@osmix/shared/types"
import type {
	DefaultSpeeds,
	GraphEdge,
	HighwayFilter,
	RoutingGraphTransferables,
} from "./types"
import {
	calculateTime,
	DEFAULT_SPEEDS,
	defaultHighwayFilter,
	getSpeedLimit,
} from "./utils"

/**
 * Routing graph built from OSM ways and nodes.
 *
 * Uses CSR (Compressed Sparse Row) format internally for memory efficiency
 * and zero-copy transfer between workers. Call `compact()` after construction
 * before using `transferables()`.
 *
 * @example Build from OSM data
 * ```ts
 * const graph = new RoutingGraph(osm)
 * graph.compact()
 * const route = router.route(graph, startNode, endNode)
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
	private nodeCount = 0
	/** Total number of edges in the graph. */
	private edgeCount = 0

	// CSR format arrays (populated after compact())
	private edgeOffsets: Uint32Array | null = null
	private edgeTargets: Uint32Array | null = null
	private edgeWayIndexes: Uint32Array | null = null
	private edgeDistances: Float32Array | null = null
	private edgeTimes: Float32Array | null = null
	private routableBits: Uint8Array | null = null
	private intersectionBits: Uint8Array | null = null

	// Temporary structures used during construction (cleared after compact())
	private tempEdges: Map<number, GraphEdge[]> | null = null
	private tempRoutable: Set<number> | null = null
	private tempIntersections: Set<number> | null = null

	/** Whether compact() has been called. */
	private compacted = false

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
		if ("nodeCount" in source) {
			// Reconstruct from transferables
			this.fromTransferables(source)
		} else {
			// Build from OSM data
			this.buildFromOsm(source, filter, defaultSpeeds)
		}
	}

	/**
	 * Reconstruct from transferables (worker transfer).
	 */
	private fromTransferables(t: RoutingGraphTransferables) {
		this.nodeCount = t.nodeCount
		this.edgeCount = t.edgeCount
		this.edgeOffsets = new Uint32Array(t.edgeOffsets)
		this.edgeTargets = new Uint32Array(t.edgeTargets)
		this.edgeWayIndexes = new Uint32Array(t.edgeWayIndexes)
		this.edgeDistances = new Float32Array(t.edgeDistances)
		this.edgeTimes = new Float32Array(t.edgeTimes)
		this.routableBits = new Uint8Array(t.routableBits)
		this.intersectionBits = new Uint8Array(t.intersectionBits)
		this.compacted = true
	}

	/**
	 * Build the graph from OSM data.
	 */
	private buildFromOsm(
		osm: Osm,
		filter: HighwayFilter,
		defaultSpeeds: DefaultSpeeds,
	) {
		this.nodeCount = osm.nodes.size
		this.tempEdges = new Map()
		this.tempRoutable = new Set()
		this.tempIntersections = new Set()

		const addEdgeToNode = (from: number, edge: GraphEdge) => {
			let nodeEdges = this.tempEdges!.get(from)
			if (!nodeEdges) {
				nodeEdges = []
				this.tempEdges!.set(from, nodeEdges)
			}
			nodeEdges.push(edge)
		}

		for (let wayIndex = 0; wayIndex < osm.ways.size; wayIndex++) {
			const tags = osm.ways.tags.getTags(wayIndex)
			if (!filter(tags)) continue

			const refs = osm.ways.getRefIds(wayIndex)
			const nodes = refs.map((ref) => osm.nodes.ids.getIndexFromId(ref))
			if (nodes.length < 2) continue

			// Create bidirectional edges between consecutive nodes (respecting one-way)
			const oneway = tags?.["oneway"] === "yes" || tags?.["oneway"] === "1"
			const speed = getSpeedLimit(tags, defaultSpeeds)

			for (let i = 0; i < nodes.length - 1; i++) {
				const nodeIndex = nodes[i]!
				const targetNodeIndex = nodes[i + 1]!
				const fromCoord = osm.nodes.getNodeLonLat({ index: nodeIndex })
				const targetCoord = osm.nodes.getNodeLonLat({ index: targetNodeIndex })

				const distance = haversineDistance(fromCoord, targetCoord)
				const time = calculateTime(distance, speed)

				// Forward edge
				addEdgeToNode(nodeIndex, {
					targetNodeIndex: targetNodeIndex,
					wayIndex,
					distance,
					time,
				})
				this.edgeCount++

				// Reverse edge (unless one-way)
				if (!oneway) {
					addEdgeToNode(targetNodeIndex, {
						targetNodeIndex: nodeIndex,
						wayIndex,
						distance,
						time,
					})
					this.edgeCount++
				}

				// Track routable nodes and intersections (nodes appearing in multiple ways)
				if (this.tempRoutable!.has(nodeIndex)) {
					this.tempIntersections!.add(nodeIndex)
				} else {
					this.tempRoutable!.add(nodeIndex)
				}

				if (this.tempRoutable!.has(targetNodeIndex)) {
					this.tempIntersections!.add(targetNodeIndex)
				} else {
					this.tempRoutable!.add(targetNodeIndex)
				}
			}
		}

		// Convert to CSR format and free temporary structures
		this.compact()
	}

	/**
	 * Convert to CSR format and free temporary structures.
	 * Must be called before transferables() or after construction for optimal memory usage.
	 */
	private compact() {
		if (this.compacted) return
		if (!this.tempEdges || !this.tempRoutable || !this.tempIntersections) {
			throw new Error("Cannot compact: graph was not built from OSM data")
		}

		// Allocate CSR arrays
		const offsetsBuffer = new BufferConstructor(
			(this.nodeCount + 1) * Uint32Array.BYTES_PER_ELEMENT,
		)
		const targetsBuffer = new BufferConstructor(
			this.edgeCount * Uint32Array.BYTES_PER_ELEMENT,
		)
		const wayIndexesBuffer = new BufferConstructor(
			this.edgeCount * Uint32Array.BYTES_PER_ELEMENT,
		)
		const distancesBuffer = new BufferConstructor(
			this.edgeCount * Float32Array.BYTES_PER_ELEMENT,
		)
		const timesBuffer = new BufferConstructor(
			this.edgeCount * Float32Array.BYTES_PER_ELEMENT,
		)

		this.edgeOffsets = new Uint32Array(offsetsBuffer)
		this.edgeTargets = new Uint32Array(targetsBuffer)
		this.edgeWayIndexes = new Uint32Array(wayIndexesBuffer)
		this.edgeDistances = new Float32Array(distancesBuffer)
		this.edgeTimes = new Float32Array(timesBuffer)

		// Build CSR format: iterate through all nodes in order
		let edgeIndex = 0
		for (let nodeIndex = 0; nodeIndex < this.nodeCount; nodeIndex++) {
			this.edgeOffsets[nodeIndex] = edgeIndex
			const edges = this.tempEdges.get(nodeIndex)
			if (edges) {
				for (const edge of edges) {
					this.edgeTargets[edgeIndex] = edge.targetNodeIndex
					this.edgeWayIndexes[edgeIndex] = edge.wayIndex
					this.edgeDistances[edgeIndex] = edge.distance
					this.edgeTimes[edgeIndex] = edge.time
					edgeIndex++
				}
			}
		}
		this.edgeOffsets[this.nodeCount] = edgeIndex

		// Build bitsets for routable and intersection flags
		const bitsetLength = Math.ceil(this.nodeCount / 8)
		const routableBuffer = new BufferConstructor(bitsetLength)
		const intersectionBuffer = new BufferConstructor(bitsetLength)
		this.routableBits = new Uint8Array(routableBuffer)
		this.intersectionBits = new Uint8Array(intersectionBuffer)

		for (const nodeIndex of this.tempRoutable) {
			const byteIndex = nodeIndex >> 3
			const bitMask = 1 << (nodeIndex & 7)
			this.routableBits[byteIndex]! |= bitMask
		}

		for (const nodeIndex of this.tempIntersections) {
			const byteIndex = nodeIndex >> 3
			const bitMask = 1 << (nodeIndex & 7)
			this.intersectionBits[byteIndex]! |= bitMask
		}

		// Free temporary structures
		this.tempEdges = null
		this.tempRoutable = null
		this.tempIntersections = null
		this.compacted = true
	}

	/**
	 * Check if a node is part of the routable network.
	 */
	isRoutable(nodeIndex: number): boolean {
		if (!this.compacted) {
			return this.tempRoutable?.has(nodeIndex) ?? false
		}
		if (nodeIndex < 0 || nodeIndex >= this.nodeCount) return false
		const byteIndex = nodeIndex >> 3
		const bitMask = 1 << (nodeIndex & 7)
		return (this.routableBits![byteIndex]! & bitMask) !== 0
	}

	/**
	 * Check if a node is an intersection (multiple ways meet).
	 */
	isIntersection(nodeIndex: number): boolean {
		if (!this.compacted) {
			return this.tempIntersections?.has(nodeIndex) ?? false
		}
		if (nodeIndex < 0 || nodeIndex >= this.nodeCount) return false
		const byteIndex = nodeIndex >> 3
		const bitMask = 1 << (nodeIndex & 7)
		return (this.intersectionBits![byteIndex]! & bitMask) !== 0
	}

	/**
	 * Get outgoing edges from a node.
	 */
	getEdges(nodeIndex: number): GraphEdge[] {
		if (!this.compacted) {
			return this.tempEdges?.get(nodeIndex) ?? []
		}
		if (
			nodeIndex < 0 ||
			nodeIndex >= this.nodeCount ||
			!this.edgeOffsets ||
			!this.edgeTargets
		) {
			return []
		}

		const start = this.edgeOffsets[nodeIndex]!
		const end = this.edgeOffsets[nodeIndex + 1]!
		const edges: GraphEdge[] = []

		for (let i = start; i < end; i++) {
			edges.push({
				targetNodeIndex: this.edgeTargets[i]!,
				wayIndex: this.edgeWayIndexes![i]!,
				distance: this.edgeDistances![i]!,
				time: this.edgeTimes![i]!,
			})
		}

		return edges
	}

	/**
	 * Get transferable buffers for passing to another thread.
	 * Must call compact() first.
	 */
	transferables(): RoutingGraphTransferables {
		if (!this.compacted) {
			throw new Error("Must call compact() before transferables()")
		}
		return {
			nodeCount: this.nodeCount,
			edgeCount: this.edgeCount,
			edgeOffsets: this.edgeOffsets!.buffer as BufferType,
			edgeTargets: this.edgeTargets!.buffer as BufferType,
			edgeWayIndexes: this.edgeWayIndexes!.buffer as BufferType,
			edgeDistances: this.edgeDistances!.buffer as BufferType,
			edgeTimes: this.edgeTimes!.buffer as BufferType,
			routableBits: this.routableBits!.buffer as BufferType,
			intersectionBits: this.intersectionBits!.buffer as BufferType,
		}
	}

	/**
	 * Get the number of nodes in the graph.
	 */
	get size(): number {
		return this.nodeCount
	}

	/**
	 * Get the number of edges in the graph.
	 */
	get edges(): number {
		return this.edgeCount
	}

	/**
	 * Find the nearest routable OSM node from a geographic point.
	 *
	 * Searches for nodes within the given radius that are part of the routing
	 * graph (i.e., lie on a routable way). Returns the closest match with its
	 * coordinates and distance.
	 *
	 * @param osm - The OSM dataset.
	 * @param point - The [lon, lat] coordinates to search from.
	 * @param maxDistanceM - Maximum search radius in meters.
	 * @returns The nearest routable node, or null if none found.
	 *
	 * @example
	 * ```ts
	 * const nearest = graph.findNearestNodeOnGraph(osm, [-73.989, 40.733], 0.5)
	 * if (nearest) {
	 *   console.log(`Found node ${nearest.nodeIndex} at ${nearest.distance}m`)
	 * }
	 * ```
	 */
	findNearestRoutableNode(osm: Osm, point: LonLat, maxDistanceM: number) {
		const nearby = osm.nodes.findIndexesWithinRadius(
			point[0],
			point[1],
			maxDistanceM / 1_000,
		)

		let best: {
			nodeIndex: number
			coordinates: LonLat
			distance: number
		} | null = null
		let bestDistM = Number.POSITIVE_INFINITY

		for (const nodeIndex of nearby) {
			if (!this.isRoutable(nodeIndex)) continue

			const nodeCoord = osm.nodes.getNodeLonLat({ index: nodeIndex })
			const distance = haversineDistance(point, nodeCoord)
			if (distance < bestDistM && distance <= maxDistanceM) {
				bestDistM = distance
				best = { nodeIndex, coordinates: nodeCoord, distance }
			}
		}

		return best
	}
}

/**
 * Build a routing graph from OSM ways.
 *
 * Convenience function that creates a RoutingGraph and compacts it.
 *
 * @param osm - The OSM dataset to build from.
 * @param filter - Function to determine which ways are routable.
 * @param defaultSpeeds - Speed limits (km/h) by highway type.
 * @returns A compacted RoutingGraph ready for pathfinding.
 */
export function buildGraph(
	osm: Osm,
	filter: HighwayFilter = defaultHighwayFilter,
	defaultSpeeds: DefaultSpeeds = DEFAULT_SPEEDS,
): RoutingGraph {
	return new RoutingGraph(osm, filter, defaultSpeeds)
}

/**
 * Get an array of buffers suitable for Comlink.transfer() or postMessage transfer list.
 * Note: SharedArrayBuffers don't need to be transferred (they're shared automatically),
 * but ArrayBuffers do. This returns only the ArrayBuffers that need explicit transfer.
 */
export function getTransferableBuffers(
	t: RoutingGraphTransferables,
): ArrayBuffer[] {
	const buffers = [
		t.edgeOffsets,
		t.edgeTargets,
		t.edgeWayIndexes,
		t.edgeDistances,
		t.edgeTimes,
		t.routableBits,
		t.intersectionBits,
	]
	// Only ArrayBuffers need to be transferred; SharedArrayBuffers are shared automatically
	return buffers.filter(
		(b): b is ArrayBuffer =>
			b instanceof ArrayBuffer && !(b instanceof SharedArrayBuffer),
	)
}
