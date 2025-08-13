export default class MultiMap<K, V> extends Map<K, V[]> {
	add(key: K, value: V) {
		if (this.has(key)) {
			this.get(key)?.push(value)
		} else {
			super.set(key, [value])
		}
	}
}
