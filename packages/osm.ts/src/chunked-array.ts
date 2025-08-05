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

	removeRange(start: number, end: number) {
		const result = new this.ArrayType(this.length - (end - start))
		result.set(this.array.subarray(0, start))
		result.set(this.array.subarray(end), start)
		this.array = result
		this.length -= end - start
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

	pushMany(values: number[] | T) {
		for (const v of values) this.push(v)
	}

	compact() {
		this.array = this.array.slice(0, this.length) as T
		return this.array
	}
}

export class ResizeableCoordinateArray extends ResizeableTypedArray<
	Float32Array<ArrayBuffer>
> {
	constructor() {
		super(Float32Array)
	}
}
