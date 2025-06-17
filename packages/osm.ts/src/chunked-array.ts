// 1. Define a generic constructor type for TypedArrays
type TypedArray =
	| Int8Array
	| Uint8Array
	| Uint8ClampedArray
	| Int16Array
	| Uint16Array
	| Int32Array
	| Uint32Array
	| Float32Array
	| Float64Array

interface TypedArrayConstructor<T extends TypedArray> {
	new (length: number): T
	readonly BYTES_PER_ELEMENT: number
}

// 2. Generic ChunkedArray class
export class ChunkedArray<T extends TypedArray> {
	#chunks: T[] = []
	length = 0
	ArrayType: TypedArrayConstructor<T>
	chunkSize: number

	constructor(ArrayType: TypedArrayConstructor<T>, chunkSize = 1024) {
		this.ArrayType = ArrayType
		this.chunkSize = chunkSize
		// Initialize with one chunk
		this.#chunks.push(new this.ArrayType(this.chunkSize))
	}

	push(value: number): number {
		const idx = this.length++
		const chunkIndex = Math.floor(idx / this.chunkSize)
		const offset = idx % this.chunkSize

		// Allocate a new chunk if needed
		if (chunkIndex >= this.#chunks.length)
			this.#chunks.push(new this.ArrayType(this.chunkSize))
		if (this.#chunks[chunkIndex] === undefined)
			throw new Error("Chunk is undefined")

		// Assign the value (casts/truncates as appropriate for integer arrays)
		this.#chunks[chunkIndex][offset] = value as T[number]
		return idx
	}

	// Optionally push multiple values at once
	pushMany(values: number[]) {
		for (const v of values) this.push(v)
	}

	// Produce one contiguous TypedArray trimmed to actual length
	finalize(): T {
		const result = new this.ArrayType(this.length)
		let pos = 0

		for (const chunk of this.#chunks) {
			const take = Math.min(chunk.length, this.length - pos)
			result.set(chunk.subarray(0, take), pos)
			pos += take
			if (pos >= this.length) break
		}

		return result
	}
}
