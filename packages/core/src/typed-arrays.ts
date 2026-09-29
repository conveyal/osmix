/**
 * Resizable typed array utilities.
 *
 * Wraps typed arrays with automatic buffer expansion (ArrayList semantics).
 * Uses SharedArrayBuffer (if available) for zero-copy worker transfer.
 *
 * @module
 */

import { isSharedArrayBuffer } from "@osmix/shared/backing-buffers";

/**
 * Use SharedArrayBuffer if the runtime supports it, otherwise fall back to ArrayBuffer.
 * SharedArrayBuffer enables zero-copy transfer between workers.
 */
export const BufferConstructor =
  typeof SharedArrayBuffer !== "undefined"
    ? (SharedArrayBuffer as SharedArrayBufferConstructor)
    : (ArrayBuffer as ArrayBufferConstructor);

/** The buffer type used by this runtime (SharedArrayBuffer or ArrayBuffer). */
export type BufferType = InstanceType<typeof BufferConstructor>;

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
  | Float64Array<B>;

/**
 * Constructor interface for typed arrays.
 */
export interface TypedArrayConstructor<T extends TypedArray<BufferType> = TypedArray<BufferType>> {
  new (buffer: BufferType, byteOffset?: number, length?: number): T;
  readonly BYTES_PER_ELEMENT: number;
  readonly name: string;
}

export type TypedBufferAllocationOperation = "create" | "grow" | "compact";
export type TypedBufferType = "array-buffer" | "shared-array-buffer";

/** Structured allocation failure suitable for transport across worker boundaries. */
export class TypedBufferAllocationError extends Error {
  readonly code = "TYPED_BUFFER_ALLOCATION_FAILED";
  readonly stage = "typed-buffer-allocation";
  readonly operation: TypedBufferAllocationOperation;
  readonly typedArray: string;
  readonly bufferType: TypedBufferType;
  readonly elementCount: number;
  readonly bytesPerElement: number;
  readonly requiredBytes: number;

  constructor(
    args: {
      operation: TypedBufferAllocationOperation;
      typedArray: string;
      bufferType: TypedBufferType;
      elementCount: number;
      bytesPerElement: number;
      requiredBytes: number;
    },
    cause: unknown,
  ) {
    super(
      `${args.typedArray} ${args.operation} requires ${args.requiredBytes.toLocaleString()} bytes in a single ${args.bufferType === "shared-array-buffer" ? "SharedArrayBuffer" : "ArrayBuffer"}.`,
      { cause },
    );
    this.name = "TypedBufferAllocationError";
    this.operation = args.operation;
    this.typedArray = args.typedArray;
    this.bufferType = args.bufferType;
    this.elementCount = args.elementCount;
    this.bytesPerElement = args.bytesPerElement;
    this.requiredBytes = args.requiredBytes;
  }
}

type BufferConstructorType = SharedArrayBufferConstructor | ArrayBufferConstructor;

function getBufferType(BC: BufferConstructorType): TypedBufferType {
  return typeof SharedArrayBuffer !== "undefined" && BC === SharedArrayBuffer
    ? "shared-array-buffer"
    : "array-buffer";
}

/**
 * Float64Array for storing OSM IDs.
 *
 * OSM IDs are 64-bit integers. JavaScript's number type (IEEE 754 double)
 * can exactly represent integers up to 2^53, which covers all current OSM IDs.
 * Float64Array allows typed array operations while maintaining precision.
 */
export const IdArrayType = Float64Array;

const MiB = 2 ** 20;

/** Starting capacity of a new column. Growth is in place, so small columns stay small. */
const INITIAL_BYTES = 64 * 1024;

/**
 * Address space a growing column reserves so that it grows in place, without copying.
 * Reserved pages hold no memory until written. Chromium's V8 sandbox has room for about 250
 * reservations of this size, and a load builds about 35 columns at once. A reservation that
 * fails falls back to growing by reallocation.
 */
const GROWTH_RESERVE_BYTES = 4 * 2 ** 30;

/** Above this size a column grows by 1.5× instead of 2×, so it overshoots less. */
const DOUBLING_LIMIT_BYTES = 256 * MiB;

/**
 * Auto-expanding typed array wrapper.
 *
 * - `push()` / `pushMany()` append, growing the buffer in place when the runtime supports
 *   growable buffers, otherwise by reallocating.
 * - `array` is a view of the stored items only; `compact()` shrinks the buffer to fit them.
 * - `from()` wraps a finished (transferred) buffer, which can still grow.
 */
export class ResizeableTypedArray<TA extends TypedArray> {
  /** The typed array constructor for this instance */
  readonly ArrayType: TypedArrayConstructor<TA>;
  /** Buffer constructor (SharedArrayBuffer or ArrayBuffer) */
  private readonly BC: BufferConstructorType;
  /** View of the whole buffer: stored items, then spare capacity. */
  private view: TA;
  /** Number of items actually stored (may be less than the capacity). */
  private items = 0;

  /**
   * The buffer size a new column reaches when it is filled one `push` at a time to
   * `requiredBytes`, for projecting peak memory before a load.
   */
  static capacityBytesFor(requiredBytes: number, bytesPerElement: number): number {
    let bytes = INITIAL_BYTES;
    while (bytes < requiredBytes) {
      bytes = nextByteLength(bytes, bytes + bytesPerElement, bytesPerElement);
    }
    return bytes;
  }

  /**
   * Wrap an existing buffer, as after transferring it between workers. Every element of the
   * buffer is a stored item. Nothing is allocated until the array grows.
   */
  static from<TA extends TypedArray>(ArrayType: TypedArrayConstructor<TA>, buffer: BufferType) {
    const BC = isSharedArrayBuffer(buffer) ? SharedArrayBuffer : ArrayBuffer;
    const rta = new ResizeableTypedArray<TA>(ArrayType, BC, new ArrayType(buffer));
    rta.items = rta.view.length;
    return rta;
  }

  /**
   * Create a new ResizeableTypedArray with an empty buffer.
   *
   * @param ArrayType - The typed array constructor (e.g., Float64Array).
   * @param BC - Buffer constructor to use (defaults to SharedArrayBuffer if available).
   */
  constructor(
    ArrayType: TypedArrayConstructor<TA>,
    BC: BufferConstructorType = BufferConstructor,
    /** @internal A view to wrap instead of allocating; used by `from()`. */
    view?: TA,
  ) {
    this.ArrayType = ArrayType;
    this.BC = BC;
    this.view = view ?? new ArrayType(this.allocate("create", INITIAL_BYTES, GROWTH_RESERVE_BYTES));
  }

  /** The stored items. Before `compact()`, a view that excludes the spare capacity. */
  get array(): TA {
    return this.items === this.view.length ? this.view : (this.view.subarray(0, this.items) as TA);
  }

  /** The underlying buffer, including any spare capacity. */
  get buffer(): BufferType {
    return this.view.buffer as BufferType;
  }

  get length() {
    return this.items;
  }

  /** Number of items the current buffer can hold before it must grow. */
  get capacity() {
    return this.view.length;
  }

  /** Iterate over the stored values. */
  [Symbol.iterator](): ArrayIterator<number> {
    return this.array[Symbol.iterator]();
  }

  /**
   * Get the value at an index. Handles negative indices.
   */
  at(index: number): number {
    if (index >= 0 && index < this.items) return this.view[index]!;
    if (index < 0 && index >= -this.items) return this.view[this.items + index]!;
    throw Error(`Index out of bounds: ${index}. Length: ${this.items}`);
  }

  /**
   * Get a copy of a range of the stored items.
   */
  slice(start: number, end: number) {
    return this.array.slice(start, end);
  }

  /**
   * Push a value to the end of the array.
   */
  push(value: number): number {
    if (this.items === this.view.length) this.ensureCapacity(this.items + 1);
    this.view[this.items] = value;
    return this.items++;
  }

  /**
   * Set a value at a specific index. Expands array if needed.
   */
  set(index: number, value: number) {
    if (index < 0) throw Error("Index out of bounds");
    if (index >= this.items) {
      this.ensureCapacity(index + 1);
      this.items = index + 1;
    }
    this.view[index] = value;
  }

  /**
   * Push multiple values to the end of the array.
   */
  pushMany(values: ArrayLike<number>) {
    this.ensureCapacity(this.items + values.length);
    this.view.set(values, this.items);
    this.items += values.length;
  }

  /**
   * Shrink the buffer to exactly fit stored items.
   * Buffer becomes fixed-length after compacting.
   */
  compact() {
    const requiredBytes = this.items * this.ArrayType.BYTES_PER_ELEMENT;
    const buffer = this.buffer;
    let compacted: BufferType;
    try {
      compacted = isSharedArrayBuffer(buffer)
        ? // A SharedArrayBuffer cannot shrink: copy the items into a fixed-size buffer.
          buffer.slice(0, requiredBytes)
        : buffer.transferToFixedLength(requiredBytes);
    } catch (cause) {
      throw this.allocationError("compact", requiredBytes, cause);
    }
    this.view = new this.ArrayType(compacted);
    return this.view;
  }

  /** Make room for `count` items: grow in place if the buffer can, otherwise reallocate. */
  private ensureCapacity(count: number) {
    if (count <= this.view.length) return;
    const bytesPerElement = this.ArrayType.BYTES_PER_ELEMENT;
    const buffer = this.buffer;
    const byteLength = nextByteLength(buffer.byteLength, count * bytesPerElement, bytesPerElement);
    if (buffer.maxByteLength >= byteLength && growInPlace(buffer, byteLength)) {
      // A resized buffer keeps a length-tracking view: take a fresh fixed-length one.
      this.view = new this.ArrayType(buffer, 0, byteLength / bytesPerElement);
      return;
    }
    const next = this.allocate("grow", byteLength, GROWTH_RESERVE_BYTES);
    const view = new this.ArrayType(next, 0, byteLength / bytesPerElement);
    view.set(this.array);
    this.view = view;
  }

  /**
   * Allocate `byteLength` bytes that can grow in place up to `reserveBytes` when the runtime
   * allows. A failed reservation falls back to a buffer that doubles once, then to fixed size.
   */
  private allocate(
    operation: TypedBufferAllocationOperation,
    byteLength: number,
    reserveBytes: number,
  ): BufferType {
    for (const maxByteLength of [Math.max(reserveBytes, byteLength), byteLength * 2]) {
      try {
        return new this.BC(byteLength, { maxByteLength });
      } catch {
        // The runtime refused the reservation: try a smaller one, then a fixed buffer.
      }
    }
    try {
      return new this.BC(byteLength);
    } catch (cause) {
      throw this.allocationError(operation, byteLength, cause);
    }
  }

  private allocationError(
    operation: TypedBufferAllocationOperation,
    requiredBytes: number,
    cause: unknown,
  ): TypedBufferAllocationError {
    return new TypedBufferAllocationError(
      {
        operation,
        typedArray: this.ArrayType.name,
        bufferType: getBufferType(this.BC),
        elementCount: Math.ceil(requiredBytes / this.ArrayType.BYTES_PER_ELEMENT),
        bytesPerElement: this.ArrayType.BYTES_PER_ELEMENT,
        requiredBytes,
      },
      cause,
    );
  }
}

/**
 * The next buffer size for a column that needs `requiredBytes`: double while small, then grow
 * by 1.5×, and never less than required. Rounded up to a multiple of 8 bytes so every element
 * type divides it.
 */
function nextByteLength(currentBytes: number, requiredBytes: number, bytesPerElement: number) {
  const current = Math.max(currentBytes, bytesPerElement);
  const grown = current < DOUBLING_LIMIT_BYTES ? current * 2 : Math.ceil(current * 1.5);
  return Math.ceil(Math.max(grown, requiredBytes) / 8) * 8;
}

/** Grow a growable or resizable buffer to `byteLength`. False if it cannot grow in place. */
function growInPlace(buffer: BufferType, byteLength: number): boolean {
  try {
    if (isSharedArrayBuffer(buffer)) {
      if (!buffer.growable) return false;
      buffer.grow(byteLength);
      return true;
    }
    if (!buffer.resizable) return false;
    buffer.resize(byteLength);
    return true;
  } catch {
    // Committing the pages failed: fall back to reallocating, which reports its own error.
    return false;
  }
}
