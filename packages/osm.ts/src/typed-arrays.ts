export type TypedArrayBuffer = SharedArrayBuffer | ArrayBuffer

export type TypedArrayBufferConstructor =
	| SharedArrayBufferConstructor
	| ArrayBufferConstructor

type TypedArray =
	| Int8Array<TypedArrayBuffer>
	| Uint8Array<TypedArrayBuffer>
	| Uint8ClampedArray<TypedArrayBuffer>
	| Int16Array<TypedArrayBuffer>
	| Uint16Array<TypedArrayBuffer>
	| Int32Array<TypedArrayBuffer>
	| Uint32Array<TypedArrayBuffer>
	| Float32Array<TypedArrayBuffer>
	| Float64Array<TypedArrayBuffer>

interface TypedArrayConstructor<T extends TypedArray> {
	new (buffer: TypedArrayBuffer, byteOffet: number, length: number): T
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
 * Use SharedArrayBuffer if the browser supports it and is cross-origin isolated.
 */
export const BufferConstructor =
	globalThis.crossOriginIsolated && globalThis.isSecureContext
		? SharedArrayBuffer
		: ArrayBuffer

export class ResizeableTypedArray<T extends TypedArray>
	implements RelativeIndexable<number>
{
	ArrayType: TypedArrayConstructor<T>

	array: T
	items = 0

	buffer: TypedArrayBuffer
	bufferSize: number

	static from<T extends TypedArray>(
		ArrayType: TypedArrayConstructor<T>,
		buffer: TypedArrayBuffer,
	) {
		const length = buffer.byteLength / ArrayType.BYTES_PER_ELEMENT
		const rta = new ResizeableTypedArray<T>(ArrayType, length)
		rta.buffer = buffer
		rta.array = new ArrayType(buffer, 0, length)
		rta.items = length
		return rta
	}

	constructor(ArrayType: TypedArrayConstructor<T>, startingLength = 1_000) {
		this.ArrayType = ArrayType
		this.bufferSize = startingLength * this.ArrayType.BYTES_PER_ELEMENT
		this.buffer = new BufferConstructor(this.bufferSize)
		this.array = new this.ArrayType(
			this.buffer,
			0,
			this.bufferSize / this.ArrayType.BYTES_PER_ELEMENT,
		)
	}

	expandArray() {
		this.bufferSize <<= 1
		const sab = new BufferConstructor(this.bufferSize)
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

	at(index: number): number {
		const result = this.array.at(index)
		if (result === undefined) throw Error(`Index out of bounds: ${index}`)
		return result
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

	pushMany(values: number[] | T) {
		while (this.length + values.length > this.array.length) this.expandArray()
		this.array.set(values, this.length)
		this.items += values.length
	}

	compact() {
		const buffer = new BufferConstructor(
			this.length * this.ArrayType.BYTES_PER_ELEMENT,
		)
		const newArray = new this.ArrayType(buffer, 0, this.length)
		newArray.set(this.array.subarray(0, this.length))
		this.array = newArray
		this.buffer = buffer
		return newArray
	}
}
