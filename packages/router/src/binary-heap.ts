/**
 * Min-heap priority queue optimized for pathfinding.
 *
 * Uses a binary heap stored in a flat array for cache-friendly access.
 * Tracks item positions to support O(log n) priority updates.
 */
export class BinaryHeap {
	private heap: number[] = []
	private priorities: number[] = []
	private positions: Map<number, number> = new Map()

	get size(): number {
		return this.heap.length
	}

	/**
	 * Add an item with given priority. If item exists, updates priority if lower.
	 */
	push(item: number, priority: number): void {
		const existing = this.positions.get(item)
		if (existing !== undefined) {
			if (priority < this.priorities[existing]!) {
				this.priorities[existing] = priority
				this.bubbleUp(existing)
			}
			return
		}

		const index = this.heap.length
		this.heap.push(item)
		this.priorities.push(priority)
		this.positions.set(item, index)
		this.bubbleUp(index)
	}

	/**
	 * Remove and return the minimum-priority item.
	 */
	pop(): number | undefined {
		if (this.heap.length === 0) return undefined

		const min = this.heap[0]!
		this.positions.delete(min)

		const last = this.heap.pop()!
		const lastPriority = this.priorities.pop()!

		if (this.heap.length > 0) {
			this.heap[0] = last
			this.priorities[0] = lastPriority
			this.positions.set(last, 0)
			this.bubbleDown(0)
		}

		return min
	}

	/**
	 * Check if item is in the heap.
	 */
	has(item: number): boolean {
		return this.positions.has(item)
	}

	/**
	 * Clear all items.
	 */
	clear(): void {
		this.heap.length = 0
		this.priorities.length = 0
		this.positions.clear()
	}

	private bubbleUp(startIndex: number): void {
		const item = this.heap[startIndex]!
		const priority = this.priorities[startIndex]!
		let index = startIndex

		while (index > 0) {
			const parentIndex = (index - 1) >> 1
			const parentPriority = this.priorities[parentIndex]!

			if (priority >= parentPriority) break

			// Swap with parent
			this.heap[index] = this.heap[parentIndex]!
			this.priorities[index] = parentPriority
			this.positions.set(this.heap[index]!, index)

			index = parentIndex
		}

		this.heap[index] = item
		this.priorities[index] = priority
		this.positions.set(item, index)
	}

	private bubbleDown(startIndex: number): void {
		const length = this.heap.length
		const item = this.heap[startIndex]!
		const priority = this.priorities[startIndex]!
		let index = startIndex

		while (true) {
			const leftIndex = (index << 1) + 1
			const rightIndex = leftIndex + 1
			let smallest = index

			if (
				leftIndex < length &&
				this.priorities[leftIndex]! < this.priorities[smallest]!
			) {
				smallest = leftIndex
			}

			if (
				rightIndex < length &&
				this.priorities[rightIndex]! < this.priorities[smallest]!
			) {
				smallest = rightIndex
			}

			if (smallest === index) break

			// Swap with smallest child
			this.heap[index] = this.heap[smallest]!
			this.priorities[index] = this.priorities[smallest]!
			this.positions.set(this.heap[index]!, index)

			index = smallest
		}

		this.heap[index] = item
		this.priorities[index] = priority
		this.positions.set(item, index)
	}
}
