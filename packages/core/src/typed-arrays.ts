/**
 * Resizable typed array utilities.
 *
 * Wraps typed arrays with automatic buffer expansion (ArrayList semantics).
 * Uses SharedArrayBuffer (if available) for zero-copy worker transfer.
 *
 * @module
 */

/**
 * Use SharedArrayBuffer if the runtime supports it, otherwise fall back to ArrayBuffer.
 * SharedArrayBuffer enables zero-copy transfer between workers.
 */
export const BufferConstructor =
	typeof SharedArrayBuffer !== "undefined"
		? (SharedArrayBuffer as SharedArrayBufferConstructor)
		: (ArrayBuffer as ArrayBufferConstructor)

/** The buffer type used by this runtime (SharedArrayBuffer or ArrayBuffer). */
export type BufferType = InstanceType<typeof BufferConstructor>

/**
 * Union of all standard typed array types.
 * Generic over buffer type to preserve SharedArrayBuffer compatibility.
 */
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

/**
 * Constructor interface for typed arrays.
 */
export interface TypedArrayConstructor<
	T extends TypedArray<BufferType> = TypedArray<BufferType>,
> {
	new (buffer: BufferType): T
	readonly BYTES_PER_ELEMENT: number
}

/**
 * Float64Array for storing OSM IDs.
 *
 * OSM IDs are 64-bit integers. JavaScript's number type (IEEE 754 double)
 * can exactly represent integers up to 2^53, which covers all current OSM IDs.
 * Float64Array allows typed array operations while maintaining precision.
 */
export const IdArrayType = Float64Array

/**
 * Uint32Array for storing array indices.
 *
 * Internal indices into typed arrays never exceed 2^32 elements,
 * so Uint32Array provides the best balance of range and memory efficiency.
 */
export const IndexArrayType = Uint32Array

/**
 * Initial buffer size for ResizeableTypedArray.
 * 1 MiB provides reasonable initial capacity while avoiding excessive memory allocation.
 */
export const DEFAULT_BUFFER_SIZE = 2 ** 20 // 1 MiB

/**
 * Auto-expanding typed array wrapper.
 *
 * - `push()` appends elements, doubling buffer size as needed.
 * - `compact()` shrinks buffer to fit data.
 * - Supports growable SharedArrayBuffer and resizable ArrayBuffer.
 */
export class ResizeableTypedArray<TA extends TypedArray> {
	/** The typed array constructor for this instance */
	ArrayType: TypedArrayConstructor<TA>
	/** The current typed array view into the buffer */
	array: TA
	/** Number of items actually stored (may be less than array.length) */
	items = 0

	/** The underlying ArrayBuffer or SharedArrayBuffer */
	buffer: BufferType
	/** Current buffer size in bytes */
	bufferSize: number
	/** Maximum byte length for growable buffers */
	maxByteLength: number

	/** Buffer constructor (SharedArrayBuffer or ArrayBuffer) */
	BC: SharedArrayBufferConstructor | ArrayBufferConstructor

	/**
	 * Reconstruct a ResizeableTypedArray from an existing buffer.
	 *
	 * Used after transferring buffers between workers. The resulting array
	 * is considered "compacted" with items = array.length.
	 *
	 * @param ArrayType - The typed array constructor.
	 * @param buffer - The existing buffer to wrap.
	 * @returns A new ResizeableTypedArray wrapping the buffer.
	 */
	static from<TA extends TypedArray>(
		ArrayType: TypedArrayConstructor<TA>,
		buffer: BufferType,
	) {
		const rta = new ResizeableTypedArray<TA>(
			ArrayType,
			buffer instanceof SharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer,
		)
		rta.buffer = buffer
		rta.array = new ArrayType(buffer)
		rta.items = rta.array.length
		return rta
	}

	/**
	 * Create a new ResizeableTypedArray with an empty buffer.
	 *
	 * @param ArrayType - The typed array constructor (e.g., Float64Array).
	 * @param BC - Buffer constructor to use (defaults to SharedArrayBuffer if available).
	 */
	constructor(
		ArrayType: TypedArrayConstructor<TA>,
		BC:
			| SharedArrayBufferConstructor
			| ArrayBufferConstructor = BufferConstructor,
	) {
		this.ArrayType = ArrayType
		this.bufferSize = DEFAULT_BUFFER_SIZE
		this.maxByteLength = DEFAULT_BUFFER_SIZE * 2
		this.BC = BC
		this.buffer = new BC(this.bufferSize, {
			maxByteLength: this.maxByteLength,
		})
		this.array = new this.ArrayType(this.buffer)
	}

	/**
	 * Iterate over the array values.
	 */
	[Symbol.iterator](): ArrayIterator<number> {
		return this.array[Symbol.iterator]()
	}

	/**
	 * Double the buffer capacity.
	 * Uses in-place grow/resize if supported, otherwise allocates new buffer and copies.
	 */
	expandArray() {
		this.bufferSize *= 2
		if (this.bufferSize > this.buffer.maxByteLength) {
			// Need a completely new buffer with larger maxByteLength
			this.maxByteLength *= 2
			const newBuffer = new this.BC(this.bufferSize, {
				maxByteLength: this.maxByteLength,
			})
			const newArray = new this.ArrayType(newBuffer)
			newArray.set(this.array)
			this.buffer = newBuffer
			this.array = newArray
		} else {
			// Can grow/resize the existing buffer in place
			if (this.buffer instanceof SharedArrayBuffer && this.buffer.growable) {
				this.buffer.grow(this.bufferSize)
			} else if (this.buffer instanceof ArrayBuffer && this.buffer.resizable) {
				this.buffer.resize(this.bufferSize)
			} else {
				throw Error("Buffer is not growable or resizable")
			}
		}
	}

	/**
	 * Get the value at an index. Handles negative indices.
	 */
	at(index: number): number {
		if (index < -this.length || index >= this.length)
			throw Error(`Index out of bounds: ${index}. Length: ${this.length}`)
		if (index < 0) return this.at(this.length + index)
		const result = this.array[index]
		if (result === undefined) throw Error(`No value at index: ${index}`)
		return result
	}

	/**
	 * Get a slice of the array.
	 */
	slice(start: number, end: number) {
		return this.array.slice(start, end)
	}

	get length() {
		return this.items
	}

	/**
	 * Push a value to the end of the array.
	 */
	push(value: number): number {
		if (this.length >= this.array.length) {
			this.expandArray()
		}
		this.array[this.items++] = value
		return this.length - 1
	}

	/**
	 * Set a value at a specific index. Expands array if needed.
	 */
	set(index: number, value: number) {
		if (index < 0) throw Error("Index out of bounds")
		if (index >= this.length) {
			while (index >= this.array.length) this.expandArray()
			this.items = index + 1
		}
		this.array[index] = value
	}

	/**
	 * Push multiple values to the end of the array.
	 */
	pushMany(values: number[] | TypedArray) {
		while (this.length + values.length > this.array.length) this.expandArray()
		this.array.set(values, this.length)
		this.items += values.length
	}

	/**
	 * Shrink the buffer to exactly fit stored items.
	 * Buffer becomes fixed-length after compacting.
	 */
	compact() {
		if (this.buffer instanceof SharedArrayBuffer) {
			// SharedArrayBuffer uses slice() to create a new fixed-size buffer
			this.buffer = this.buffer.slice(
				0,
				this.length * this.ArrayType.BYTES_PER_ELEMENT,
			)
		} else {
			// ArrayBuffer uses transferToFixedLength() to detach and resize
			this.buffer = this.buffer.transferToFixedLength(
				this.length * this.ArrayType.BYTES_PER_ELEMENT,
			)
		}
		this.array = new this.ArrayType(this.buffer)
		return this.array
	}
}
