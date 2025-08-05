export default class StringTable {
	strings: string[] = []
	indexes: Map<string, number> | null = new Map()

	constructor(preloadStrings: string[] = []) {
		for (const string of preloadStrings) {
			this.add(string)
		}
	}

	add(string: string) {
		if (!this.indexes) throw Error("StringTable has been compacted.")
		const index = this.indexes?.get(string)
		if (index) return index
		const newIndex = this.strings.length
		this.strings.push(string)
		this.indexes?.set(string, newIndex)
		return newIndex
	}

	get(index: number) {
		return this.strings[index]
	}

	get length() {
		return this.strings.length
	}

	compact() {
		this.indexes = null
	}
}
