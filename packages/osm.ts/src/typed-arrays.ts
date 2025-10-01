type BufferConstructorType =
	| SharedArrayBufferConstructor
	| ArrayBufferConstructor

/**
 * Use SharedArrayBuffer if the browser supports it and is cross-origin isolated,
 * otherwise fall back to ArrayBuffer.
 */
export const DefaultBufferConstructor: BufferConstructorType =
	typeof SharedArrayBuffer !== "undefined" &&
	globalThis.crossOriginIsolated &&
	globalThis.isSecureContext
		? SharedArrayBuffer
		: ArrayBuffer

type TypedArray<B extends ArrayBufferLike> =
	| Int8Array<B>
	| Uint8Array<B>
	| Uint8ClampedArray<B>
	| Int16Array<B>
	| Uint16Array<B>
	| Int32Array<B>
	| Uint32Array<B>
	| Float32Array<B>
	| Float64Array<B>

interface TypedArrayConstructor<
	B extends ArrayBufferLike,
	T extends TypedArray<B>,
> {
	new (buffer: B, byteOffet: number, length: number): T
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

export class ResizeableTypedArray<
	BC extends new (
		byteLength: number,
	) => ABL,
	ABL extends ArrayBufferLike,
	TA extends TypedArray<ABL>,
> implements RelativeIndexable<number>
{
	ArrayType: TypedArrayConstructor<ABL, TA>
	BufferConstructor: BC

	array: TA
	items = 0

	buffer: ABL
	bufferSize: number

	static from<
		BC extends new (
			byteLength: number,
		) => ABL,
		ABL extends ArrayBufferLike,
		TA extends TypedArray<ABL>,
	>(
		ArrayType: TypedArrayConstructor<ABL, TA>,
		buffer: ABL,
		bufferConstructor: BC = DefaultBufferConstructor as BC,
	) {
		const length = buffer.byteLength / ArrayType.BYTES_PER_ELEMENT
		const rta = new ResizeableTypedArray<BC, ABL, TA>(
			ArrayType,
			bufferConstructor,
			length,
		)
		rta.buffer = buffer
		rta.array = new ArrayType(buffer, 0, length)
		rta.items = length
		return rta
	}

	constructor(
		ArrayType: TypedArrayConstructor<ABL, TA>,
		bufferConstructor: BC = DefaultBufferConstructor as BC,
		startingLength = 10_000,
	) {
		this.ArrayType = ArrayType
		this.BufferConstructor = bufferConstructor
		this.bufferSize = startingLength * this.ArrayType.BYTES_PER_ELEMENT
		this.buffer = new bufferConstructor(this.bufferSize)
		this.array = new this.ArrayType(
			this.buffer,
			0,
			this.bufferSize / this.ArrayType.BYTES_PER_ELEMENT,
		)
	}

	expandArray() {
		this.bufferSize <<= 1
		const sab = new this.BufferConstructor(this.bufferSize)
		const newArray = new this.ArrayType(
			sab,
			0,
			this.bufferSize / this.ArrayType.BYTES_PER_ELEMENT,
		)
		if (this.array) newArray.set(this.array)
		this.array = newArray
		this.buffer = sab
		return newArray
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

	slice(start: number, end: number): TA {
		return this.array.slice(start, end) as TA
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

	pushMany(values: number[] | TA) {
		while (this.length + values.length > this.array.length) this.expandArray()
		this.array.set(values, this.length)
		this.items += values.length
	}

	compact() {
		const buffer = new this.BufferConstructor(
			this.length * this.ArrayType.BYTES_PER_ELEMENT,
		)
		const newArray = new this.ArrayType(buffer, 0, this.length)
		newArray.set(this.array.subarray(0, this.length))
		this.array = newArray
		this.buffer = buffer
		return newArray
	}
}
