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

export class ResizeableArray<T extends TypedArray>
	implements RelativeIndexable<number>
{
	ArrayType: TypedArrayConstructor<T>
	length = 0
	array: T

	constructor(ArrayType: TypedArrayConstructor<T>, startSize = 1_000) {
		this.ArrayType = ArrayType
		this.array = new this.ArrayType(startSize)
	}

	at(index: number): number {
		return this.array[index]
	}

	remove(index: number) {
		const result = new this.ArrayType(this.length - 1)
		result.set(this.array.subarray(0, index))
		result.set(this.array.subarray(index + 1), index)

		this.array.copyWithin(index, index + 1, this.length)
		this.array = result
		this.length--
	}

	push(value: number): number {
		if (this.length >= this.array.length) {
			const newArray = new this.ArrayType(this.array.length * 2)
			newArray.set(this.array)
			this.array = newArray
		}
		this.array[this.length++] = value
		return this.length - 1
	}

	condense() {
		this.array = this.array.slice(0, this.length) as T
	}
}
