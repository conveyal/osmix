import type { PathSegment, RoutingAlgorithmFn } from "../types"

/**
 * Bidirectional BFS - fast path finding from both ends.
 *
 * Uses breadth-first search from both start and end, terminating when
 * the frontiers meet. Very fast for finding any path, though not always
 * the optimal shortest path. Use Dijkstra or A* if optimality is required.
 */
export const bidirectional: RoutingAlgorithmFn = (
	graph,
	start,
	end,
	getWeight,
) => {
	if (start === end) return [{ nodeIndex: start, cost: 0 }]

	// Forward search state
	const fDist = new Map<number, number>()
	const fPrev = new Map<number, PathSegment>()
	const fQueue: number[] = [start]

	// Backward search state
	const bDist = new Map<number, number>()
	const bPrev = new Map<number, PathSegment>()
	const bQueue: number[] = [end]

	fDist.set(start, 0)
	bDist.set(end, 0)

	let meetNode: number | null = null

	while (fQueue.length > 0 && bQueue.length > 0) {
		// Expand forward
		if (fQueue.length > 0) {
			const current = fQueue.shift()!
			const currentD = fDist.get(current)!

			// Check if backward search reached this node
			if (bDist.has(current)) {
				meetNode = current
				break
			}

			for (const edge of graph(current)) {
				const neighbor = edge.targetNodeIndex
				if (fDist.has(neighbor)) continue

				const newD = currentD + getWeight(edge)
				fDist.set(neighbor, newD)
				fPrev.set(neighbor, {
					nodeIndex: neighbor,
					wayIndex: edge.wayIndex,
					previousNodeIndex: current,
					cost: newD,
				})
				fQueue.push(neighbor)

				if (bDist.has(neighbor)) {
					meetNode = neighbor
					break
				}
			}

			if (meetNode !== null) break
		}

		// Expand backward
		if (bQueue.length > 0) {
			const current = bQueue.shift()!
			const currentD = bDist.get(current)!

			// Check if forward search reached this node
			if (fDist.has(current)) {
				meetNode = current
				break
			}

			for (const edge of graph(current)) {
				const neighbor = edge.targetNodeIndex
				if (bDist.has(neighbor)) continue

				const newD = currentD + getWeight(edge)
				bDist.set(neighbor, newD)
				bPrev.set(neighbor, {
					nodeIndex: neighbor,
					wayIndex: edge.wayIndex,
					previousNodeIndex: current,
					cost: newD,
				})
				bQueue.push(neighbor)

				if (fDist.has(neighbor)) {
					meetNode = neighbor
					break
				}
			}

			if (meetNode !== null) break
		}
	}

	if (meetNode === null) return null

	// Build forward path: start -> meet
	const forward: PathSegment[] = []
	let curr: number | undefined = meetNode
	while (curr !== undefined && curr !== start) {
		const seg = fPrev.get(curr)
		if (!seg) break
		forward.unshift(seg)
		curr = seg.previousNodeIndex
	}
	forward.unshift({ nodeIndex: start, cost: 0 })

	// Build backward path: meet -> end (reverse direction)
	curr = meetNode
	while (curr !== undefined && curr !== end) {
		const seg = bPrev.get(curr)
		if (!seg) break
		curr = seg.previousNodeIndex
		if (curr !== undefined) {
			forward.push({
				nodeIndex: curr,
				wayIndex: seg.wayIndex,
				previousNodeIndex: seg.nodeIndex,
				cost: fDist.get(meetNode)! + (bDist.get(curr) ?? 0),
			})
		}
	}

	return forward
}
