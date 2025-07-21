export default class UnorderedPairMap<V> {
	#map = new Map<string, V>()

	set(a: number, b: number, value: V) {
		const key = makeKey(a, b)
		return this.#map.set(key, value)
	}

	get(a: number, b: number): V | undefined {
		const key = makeKey(a, b)
		return this.#map.get(key)
	}

	has(a: number, b: number): boolean {
		const key = makeKey(a, b)
		return this.#map.has(key)
	}

	delete(a: number, b: number): boolean {
		const key = makeKey(a, b)
		return this.#map.delete(key)
	}

	get size() {
		return this.#map.size
	}

	clear() {
		this.#map.clear()
	}

	*[Symbol.iterator]() {
		for (const [key, value] of this.#map) {
			const [a, b] = key.split(",").map(Number)
			yield [a as number, b as number, value] as const
		}
	}
}

// Helper to produce a canonical string key
function makeKey(a: number, b: number): string {
	return a < b ? `${a},${b}` : `${b},${a}`
}
