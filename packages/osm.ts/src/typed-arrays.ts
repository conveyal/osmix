/**
 * Use SharedArrayBuffer if the runtime supports it, otherwise fall back to ArrayBuffer.
 */
export const BufferConstructor =
	typeof SharedArrayBuffer !== "undefined"
		? (SharedArrayBuffer as SharedArrayBufferConstructor)
		: (ArrayBuffer as ArrayBufferConstructor)
export type BufferType = InstanceType<typeof BufferConstructor>

export type TypedArray<B extends BufferType = BufferType> =
	| Int8Array<B>
	| Uint8Array<B>
	| Uint8ClampedArray<B>
	| Int16Array<B>
	| Uint16Array<B>
	| Int32Array<B>
	| Uint32Array<B>
	| Float32Array<B>
	| Float64Array<B>

export interface TypedArrayConstructor<
	T extends TypedArray<BufferType> = TypedArray<BufferType>,
> {
	new (buffer: BufferType): T
	readonly BYTES_PER_ELEMENT: number
}

/**
 * OSM IDs can be stored as 64-bit floating point numbers.
 */
export const IdArrayType = Float64Array

/**
 * When we are storing coordinates, we need to be able to store 64-bit floating point numbers.
 * However, for benchmarking it is handy to test 32-bit floating point numbers.
 */
export const CoordinateArrayType = Float64Array

/**
 * When we are storing indexes into other arrays, we never need an index to exceed 2^32.
 */
export const IndexArrayType = Uint32Array

/**
 * Default max byte length for the buffer.
 */
export const DEFAULT_MAX_BYTE_LENGTH = 2 ** 30

export class ResizeableTypedArray<TA extends TypedArray>
	implements RelativeIndexable<number>
{
	ArrayType: TypedArrayConstructor<TA>
	array: TA
	items = 0

	buffer: BufferType
	bufferSize: number

	static from<TA extends TypedArray>(
		ArrayType: TypedArrayConstructor<TA>,
		buffer: BufferType,
	) {
		const rta = new ResizeableTypedArray<TA>(ArrayType)
		rta.buffer = buffer
		rta.array = new ArrayType(buffer)
		rta.items = length
		return rta
	}

	constructor(ArrayType: TypedArrayConstructor<TA>) {
		this.ArrayType = ArrayType
		this.bufferSize = DEFAULT_MAX_BYTE_LENGTH
		this.buffer = new BufferConstructor(this.bufferSize, {
			maxByteLength: DEFAULT_MAX_BYTE_LENGTH,
		})
		this.array = new this.ArrayType(this.buffer)
	}

	expandArray() {
		this.bufferSize *= 2
		if (this.bufferSize > this.buffer.maxByteLength) {
			throw Error("Buffer is too large")
		}

		if (this.buffer instanceof SharedArrayBuffer) {
			if (this.buffer.growable) {
				this.buffer.grow(this.bufferSize)
			}
		} else if (this.buffer.resizable) {
			this.buffer.resize(this.bufferSize)
		} else {
			throw Error("Buffer is not growable or resizable")
		}

		return this.array
	}

	/**
	 * Handle negative numbers
	 */
	at(index: number): number {
		if (index < 0) {
			const newIndex = this.length + index
			if (newIndex < 0) throw Error(`Index out of bounds: ${index}`)
			return this.at(newIndex)
		}
		const result = this.array.at(index)
		if (result === undefined || index >= this.length)
			throw Error(`Index out of bounds: ${index}`)
		return result
	}

	slice(start: number, end: number) {
		return this.array.slice(start, end)
	}

	get length() {
		return this.items
	}

	push(value: number): number {
		if (this.length >= this.array.length) {
			this.expandArray()
		}
		this.array[this.items++] = value
		return this.length - 1
	}

	pushMany(values: number[] | TypedArray) {
		while (this.length + values.length > this.array.length) this.expandArray()
		this.array.set(values, this.length)
		this.items += values.length
	}

	compact() {
		const buffer = new BufferConstructor(
			this.length * this.ArrayType.BYTES_PER_ELEMENT,
		)
		const newArray = new this.ArrayType(buffer)
		newArray.set(this.array.subarray(0, this.length))
		this.array = newArray
		this.buffer = buffer
		return newArray
	}
}
