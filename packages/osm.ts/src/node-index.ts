import KDBush from "kdbush"
import { ResizeableArray } from "./chunked-array"
import type { Bbox, OsmNode } from "./types"

export class NodeIndex {
	size = 0
	idByIndex = new ResizeableArray(Float64Array)
	latByIndex = new ResizeableArray(Float64Array)
	lonByIndex = new ResizeableArray(Float64Array)
	bbox: Bbox = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	]
	spatialIndex: KDBush = new KDBush(0)

	stringTable: string[]
	uniqueStrings: Set<string> = new Set()
	tagStartByIndex = new ResizeableArray(Uint32Array)
	tagCountByIndex = new ResizeableArray(Uint32Array)
	tagIndexes = new ResizeableArray(Uint32Array)

	idsSorted: Float64Array = new Float64Array(0)
	sortedIdPositionToIndex: Uint32Array = new Uint32Array(0)
	anchors: Float64Array = new Float64Array(0)
	blockSize = 256

	constructor(stringTable: string[]) {
		this.stringTable = stringTable
	}

	addString(s: string): number {
		this.uniqueStrings.add(s)
		const index = this.stringTable.indexOf(s)
		if (index === -1) {
			return this.stringTable.push(s) - 1
		}
		return index
	}

	addNode(node: OsmNode) {
		this.idByIndex.push(node.id)
		this.latByIndex.push(node.lat)
		this.lonByIndex.push(node.lon)

		const tagKeyValues: number[] = []
		if (node.tags) {
			for (const [key, value] of Object.entries(node.tags)) {
				tagKeyValues.push(this.addString(key))
				tagKeyValues.push(this.addString(value.toString()))
			}
		}

		this.tagStartByIndex.push(this.tagIndexes.length)
		this.tagCountByIndex.push(tagKeyValues.length)
		for (const tagKeyValueIndex of tagKeyValues) {
			this.tagIndexes.push(tagKeyValueIndex)
		}

		if (node.lon < this.bbox[0]) this.bbox[0] = node.lon
		if (node.lat < this.bbox[1]) this.bbox[1] = node.lat
		if (node.lon > this.bbox[2]) this.bbox[2] = node.lon
		if (node.lat > this.bbox[3]) this.bbox[3] = node.lat
	}

	*[Symbol.iterator]() {
		for (let i = 0; i < this.size; i++) {
			const node = this.getByIndex(i)
			if (node) yield node
		}
	}

	get(id: number): OsmNode | null {
		const index = this.getIndex(id)
		if (index === -1) return null
		return this.getByIndex(index)
	}

	getNodePosition(id: number): [number, number] {
		const index = this.getIndex(id)
		if (index === -1) throw new Error(`Node ${id} not found`)
		return [this.lonByIndex.at(index), this.latByIndex.at(index)]
	}

	getByIndex(index: number): OsmNode {
		const tagCount = this.tagCountByIndex.at(index)
		if (tagCount > 0) {
			const tagStart = this.tagStartByIndex.at(index)
			const tagIndexes = this.tagIndexes.array.slice(
				tagStart,
				tagStart + tagCount,
			)
			const tags: OsmNode["tags"] = {}
			for (let i = 0; i < tagCount; i += 2) {
				tags[this.stringTable[tagIndexes[i]]] =
					this.stringTable[tagIndexes[i + 1]]
			}
			return {
				id: this.idByIndex.at(index),
				lat: this.latByIndex.at(index),
				lon: this.lonByIndex.at(index),
				tags,
			}
		}
		return {
			id: this.idByIndex.at(index),
			lat: this.latByIndex.at(index),
			lon: this.lonByIndex.at(index),
		}
	}

	set(_: OsmNode) {
		throw new Error("NodeIndex.set not implemented yet")
	}

	delete(id: number) {
		const index = this.getIndex(id)
		if (index === -1) return
		this.idByIndex.remove(index)
		this.latByIndex.remove(index)
		this.lonByIndex.remove(index)
	}

	finish() {
		console.time("NodeIndex.finish")
		this.idByIndex.condense()
		this.latByIndex.condense()
		this.lonByIndex.condense()
		this.tagStartByIndex.condense()
		this.tagCountByIndex.condense()
		this.tagIndexes.condense()

		this.size = this.idByIndex.length
		this.spatialIndex = new KDBush(this.size)

		// Build the sorted index
		this.idsSorted = new Float64Array(this.size)
		this.sortedIdPositionToIndex = new Uint32Array(this.size)

		// Fill and sort with positions. Create the spatial index simultaneously.
		for (let i = 0; i < this.size; i++) {
			this.idsSorted[i] = this.idByIndex.at(i)
			this.sortedIdPositionToIndex[i] = i
			this.spatialIndex.add(this.lonByIndex.at(i), this.latByIndex.at(i))
		}

		// Finish the spatial index
		this.spatialIndex.finish()

		// Sort by id, carrying position; use native sort on chunks or a custom radix/merge for stability.
		// For simplicity:
		const tmp = Array.from({ length: this.size }, (_, i) => ({
			id: this.idsSorted[i],
			pos: this.sortedIdPositionToIndex[i],
		}))
		tmp.sort((a, b) => a.id - b.id)
		for (let i = 0; i < this.size; i++) {
			this.idsSorted[i] = tmp[i].id
			this.sortedIdPositionToIndex[i] = tmp[i].pos
		}

		// Build anchors (every blockSize-th key)
		const aLen = Math.ceil(this.size / this.blockSize)
		this.anchors = new Float64Array(aLen)
		for (let j = 0; j < aLen; j++) {
			this.anchors[j] =
				this.idsSorted[Math.min(j * this.blockSize, this.size - 1)]
		}

		console.timeEnd("NodeIndex.finish")
	}

	// Lookup id → index
	getIndex(id: number): number {
		// binary search anchors
		let lo = 0
		let hi = this.anchors.length - 1
		while (lo < hi) {
			const mid = (lo + hi + 1) >>> 1
			if (this.anchors[mid] <= id) lo = mid
			else hi = mid - 1
		}
		const start = lo * this.blockSize
		const end = Math.min(start + this.blockSize, this.idsSorted.length)

		// binary search within block
		let l = start
		let r = end - 1
		while (l <= r) {
			const m = (l + r) >>> 1
			const v = this.idsSorted[m]
			if (v === id) return this.sortedIdPositionToIndex[m]
			if (v < id) l = m + 1
			else r = m - 1
		}

		// ID not found
		return -1
	}

	// Spatial operations

	rebuildSpatialIndex() {
		this.spatialIndex = new KDBush(this.size)
		for (const node of this) {
			this.spatialIndex.add(node.lon, node.lat)
		}
		this.spatialIndex.finish()
	}

	findNeighborsWithin(node: OsmNode, radius = 0) {
		const ids = this.spatialIndex.within(node.lon, node.lat, radius)
		return ids
			.map((i) => this.getByIndex(i))
			.filter((n) => {
				return n.id !== node.id
			})
	}

	within(x: number, y: number, radius = 0) {
		const ids = this.spatialIndex.within(x, y, radius)
		return ids.map((i) => this.getByIndex(i))
	}

	findOverlappingNodes(nodes: OsmNode[], radius = 0) {
		return findOverlappingNodes(this, nodes, radius)
	}
}

/**
 * Find nodes that are within a certain radius of each other.
 * @param index The index to search in.
 * @param nodes The nodes to search for.
 * @param radius The radius to search for. Defaults to 0, which means the nodes must be at the same location.
 * @returns A map of node IDs to sets of node IDs that are within the radius.
 */
export function findOverlappingNodes(
	index: NodeIndex,
	nodes: OsmNode[],
	radius = 0,
) {
	const overlapping = new Map<number, Set<number>>()
	for (const node of nodes) {
		const closeNodes = index.findNeighborsWithin(node, radius)
		if (closeNodes.length === 0) continue
		const overlappingNodes = new Set<number>()
		for (const closeNode of closeNodes) {
			if (overlapping.has(closeNode.id)) {
				overlapping.get(closeNode.id)?.add(node.id)
			} else {
				overlappingNodes.add(closeNode.id)
			}
		}
		if (overlappingNodes.size > 0) {
			overlapping.set(node.id, overlappingNodes)
		}
	}
	return overlapping
}
