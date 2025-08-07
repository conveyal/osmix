type TypedArray =
	| Int8Array<ArrayBuffer>
	| Uint8Array<ArrayBuffer>
	| Uint8ClampedArray<ArrayBuffer>
	| Int16Array<ArrayBuffer>
	| Uint16Array<ArrayBuffer>
	| Int32Array<ArrayBuffer>
	| Uint32Array<ArrayBuffer>
	| Float32Array<ArrayBuffer>
	| Float64Array<ArrayBuffer>

interface TypedArrayConstructor<T extends TypedArray> {
	new (length: number): T
	readonly BYTES_PER_ELEMENT: number
}

export class ResizeableTypedArray<T extends TypedArray>
	implements RelativeIndexable<number>
{
	ArrayType: TypedArrayConstructor<T>
	items = 0
	array: T

	constructor(ArrayType: TypedArrayConstructor<T>, startSize = 100_000_000) {
		this.ArrayType = ArrayType
		this.array = new this.ArrayType(
			startSize / this.ArrayType.BYTES_PER_ELEMENT,
		)
	}

	expandArray() {
		const newArray = new this.ArrayType(this.array.length * 2)
		newArray.set(this.array)
		this.array = newArray
	}

	at(index: number): number {
		return this.array[index]
	}

	get length() {
		return this.items
	}

	remove(index: number) {
		const result = new this.ArrayType(this.length - 1)
		result.set(this.array.subarray(0, index))
		result.set(this.array.subarray(index + 1), index)

		this.array.copyWithin(index, index + 1, this.length)
		this.array = result
		this.items--
	}

	removeRange(start: number, end: number) {
		const result = new this.ArrayType(this.length - (end - start))
		result.set(this.array.subarray(0, start))
		result.set(this.array.subarray(end), start)
		this.array = result
		this.items -= end - start
	}

	push(value: number): number {
		if (this.length >= this.array.length) {
			const newArray = new this.ArrayType(this.array.length * 2)
			newArray.set(this.array)
			this.array = newArray
		}
		this.array[this.items++] = value
		return this.length - 1
	}

	pushMany(values: number[] | T) {
		while (this.length + values.length > this.array.length) this.expandArray()
		this.array.set(values, this.length)
		this.items += values.length
	}

	compact() {
		this.array = this.array.slice(0, this.length) as T
		return this.array
	}
}

/**
 * OSM IDs can be stored as 64-bit floating point numbers.
 */
export class ResizeableIdArray extends ResizeableTypedArray<
	Float64Array<ArrayBuffer>
> {
	constructor() {
		super(Float64Array)
	}
}

/**
 * When we are storing coordinates, we need to be able to store 64-bit floating point numbers.
 * However, for benchmarking it is handy to test 32-bit floating point numbers.
 */
export class ResizeableCoordinateArray extends ResizeableTypedArray<
	Float64Array<ArrayBuffer>
> {
	constructor() {
		super(Float64Array)
	}
}

/**
 * When we are storing indexes into other arrays, we never need an index to exceed 2^32.
 */
export class ResizeableIndexArray extends ResizeableTypedArray<
	Uint32Array<ArrayBuffer>
> {
	constructor() {
		super(Uint32Array)
	}
}
