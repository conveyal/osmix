import { describe, expect, it } from "vitest";

import {
  BufferConstructor,
  ResizeableTypedArray,
  TypedBufferAllocationError,
} from "../src/typed-arrays";

const INITIAL_BYTES = 64 * 1024;

class FailingCreateArrayBuffer extends ArrayBuffer {
  constructor() {
    super(0);
    throw new RangeError("create failed");
  }
}

/** Allocates the first buffer, but can neither resize it nor allocate a larger one. */
class FailingGrowArrayBuffer extends ArrayBuffer {
  constructor(byteLength: number, options?: { maxByteLength?: number }) {
    if (byteLength > INITIAL_BYTES) throw new RangeError("grow failed");
    super(byteLength, options);
  }

  override resize(): void {
    throw new RangeError("resize failed");
  }
}

class FailingCompactArrayBuffer extends ArrayBuffer {
  override transferToFixedLength(): ArrayBuffer {
    throw new RangeError("compact failed");
  }
}

/** Refuses any `maxByteLength` reservation, like a runtime out of address space. */
class NoReserveArrayBuffer extends ArrayBuffer {
  constructor(byteLength: number, options?: { maxByteLength?: number }) {
    if (options?.maxByteLength !== undefined) throw new RangeError("no reservation");
    super(byteLength);
  }
}

describe("typed array helpers", () => {
  it("selects the appropriate buffer constructor", () => {
    if (typeof SharedArrayBuffer !== "undefined") {
      expect(BufferConstructor).toBe(SharedArrayBuffer);
    } else {
      expect(BufferConstructor).toBe(ArrayBuffer);
    }
  });

  describe("ResizeableTypedArray", () => {
    it("reports structured create allocation failures", () => {
      expect(
        () =>
          new ResizeableTypedArray(
            Float64Array,
            FailingCreateArrayBuffer as unknown as ArrayBufferConstructor,
          ),
      ).toThrowError(
        expect.objectContaining({
          name: "TypedBufferAllocationError",
          code: "TYPED_BUFFER_ALLOCATION_FAILED",
          operation: "create",
          typedArray: "Float64Array",
          bufferType: "array-buffer",
          elementCount: INITIAL_BYTES / 8,
          bytesPerElement: 8,
          requiredBytes: INITIAL_BYTES,
        }),
      );
    });

    it("reports structured grow allocation failures", () => {
      const arr = new ResizeableTypedArray(
        Uint8Array,
        FailingGrowArrayBuffer as unknown as ArrayBufferConstructor,
      );
      arr.pushMany(new Uint8Array(INITIAL_BYTES));

      expect(() => arr.push(1)).toThrowError(
        expect.objectContaining({
          operation: "grow",
          typedArray: "Uint8Array",
          elementCount: INITIAL_BYTES * 2,
          requiredBytes: INITIAL_BYTES * 2,
        }),
      );
      expect(arr.length).toBe(INITIAL_BYTES);
    });

    it("reports structured compact allocation failures", () => {
      const arr = new ResizeableTypedArray(
        Float64Array,
        FailingCompactArrayBuffer as unknown as ArrayBufferConstructor,
      );
      arr.pushMany([1, 2, 3]);

      try {
        arr.compact();
        expect.unreachable("Expected compact to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(TypedBufferAllocationError);
        expect(error).toMatchObject({
          operation: "compact",
          typedArray: "Float64Array",
          elementCount: 3,
          bytesPerElement: 8,
          requiredBytes: 24,
        });
        expect((error as Error).cause).toBeInstanceOf(RangeError);
      }
    });

    it("push stores values and returns the index", () => {
      const arr = new ResizeableTypedArray(Float64Array);

      expect(arr.push(1.5)).toBe(0);
      expect(arr.push(2.5)).toBe(1);
      expect(arr.length).toBe(2);
      expect(arr.at(0)).toBe(1.5);
      expect(arr.at(1)).toBe(2.5);
    });

    it("at supports negative indices and guards bounds", () => {
      const arr = new ResizeableTypedArray(Int16Array);
      arr.pushMany([10, 20, 30]);

      expect(arr.at(-1)).toBe(30);
      expect(arr.at(-3)).toBe(10);
      expect(() => arr.at(-4)).toThrow(/Index out of bounds/);
      expect(() => arr.at(3)).toThrow(/Index out of bounds/);
    });

    it("pushMany appends arrays while preserving order, across growth", () => {
      const arr = new ResizeableTypedArray(Uint32Array);
      arr.pushMany([1, 2, 3]);
      arr.pushMany(Uint32Array.from([4, 5]));
      expect(Array.from(arr.array)).toEqual([1, 2, 3, 4, 5]);

      // One call that needs several doublings grows once, to at least the needed size.
      const many = Uint32Array.from({ length: 100_000 }, (_, i) => i);
      arr.pushMany(many);
      expect(arr.length).toBe(100_005);
      expect(arr.at(-1)).toBe(99_999);
      expect(arr.capacity).toBeGreaterThanOrEqual(100_005);
    });

    it("exposes only stored items through array, iteration and slice", () => {
      const arr = new ResizeableTypedArray(Uint8Array);
      arr.pushMany([1, 2, 3, 4]);

      expect(arr.capacity).toBeGreaterThan(4);
      expect(arr.array.length).toBe(4);
      expect([...arr]).toEqual([1, 2, 3, 4]);

      const segment = arr.slice(1, 3);
      expect(segment).toBeInstanceOf(Uint8Array);
      expect(Array.from(segment)).toEqual([2, 3]);
      segment[0] = 99;
      expect(arr.at(1)).toBe(2);
    });

    it("set grows and extends the length", () => {
      const arr = new ResizeableTypedArray(Float32Array);
      arr.set(100_000, 5);
      expect(arr.length).toBe(100_001);
      expect(arr.at(100_000)).toBe(5);
      expect(arr.at(0)).toBe(0);
    });

    it("compact trims unused capacity", () => {
      const arr = new ResizeableTypedArray(Float64Array);
      arr.pushMany([5, 6, 7]);

      const compacted = arr.compact();

      expect(compacted).toBe(arr.array);
      expect(compacted.length).toBe(3);
      expect(arr.capacity).toBe(3);
      expect(arr.buffer.byteLength).toBe(3 * Float64Array.BYTES_PER_ELEMENT);
    });

    it("grows again after compact", () => {
      const arr = new ResizeableTypedArray(Uint16Array);
      arr.pushMany([1, 2]);
      arr.compact();
      arr.push(3);
      expect(Array.from(arr.array)).toEqual([1, 2, 3]);
    });

    it("from wraps a transferred buffer without allocating, and can grow past 2 MiB", () => {
      // A finished column larger than 2 MiB, as received from another worker.
      const backing = new ArrayBuffer(4 * 2 ** 20);
      new Uint32Array(backing).set([1, 2, 3, 4]);

      const arr = ResizeableTypedArray.from(Uint32Array, backing);
      expect(arr.buffer).toBe(backing);
      expect(arr.length).toBe(2 ** 20);
      expect(arr.at(3)).toBe(4);

      arr.push(5);
      expect(arr.length).toBe(2 ** 20 + 1);
      expect(arr.at(-1)).toBe(5);
      expect(arr.at(3)).toBe(4);
    });

    it("falls back to reallocating when the runtime refuses a reservation", () => {
      const arr = new ResizeableTypedArray(
        Uint8Array,
        NoReserveArrayBuffer as unknown as ArrayBufferConstructor,
      );
      const first = arr.buffer;
      arr.pushMany(new Uint8Array(INITIAL_BYTES + 1).fill(7));
      expect(arr.buffer).not.toBe(first);
      expect(arr.length).toBe(INITIAL_BYTES + 1);
      expect(arr.at(-1)).toBe(7);
    });

    it("projects the capacity a column reaches: doubling, then 1.5× above 256 MiB", () => {
      const MiB = 2 ** 20;
      expect(ResizeableTypedArray.capacityBytesFor(10, 8)).toBe(INITIAL_BYTES);
      expect(ResizeableTypedArray.capacityBytesFor(3 * MiB, 8)).toBe(4 * MiB);
      expect(ResizeableTypedArray.capacityBytesFor(300 * MiB, 8)).toBe(384 * MiB);
      // Just over 2 GiB no longer asks for 4 GiB.
      const capacity = ResizeableTypedArray.capacityBytesFor(2 * 1024 * MiB + 8, 8);
      expect(capacity).toBeLessThan(3 * 1024 * MiB);
      expect(capacity).toBeGreaterThanOrEqual(2 * 1024 * MiB + 8);
    });

    it("grows in place without copying", () => {
      const arr = new ResizeableTypedArray(Float64Array);
      const first = arr.buffer;
      for (let i = 0; i < 100_000; i++) arr.push(i);
      expect(arr.buffer).toBe(first);
      expect(arr.at(99_999)).toBe(99_999);
    });

    if (typeof SharedArrayBuffer !== "undefined") {
      it("grows a transferred growable shared buffer in place", () => {
        const backing = new SharedArrayBuffer(8, { maxByteLength: 32 });
        new Uint8Array(backing).set([1, 2, 3, 4, 5, 6, 7, 8]);

        const arr = ResizeableTypedArray.from(Uint8Array, backing);
        arr.push(9);

        expect(arr.buffer).toBe(backing);
        expect(arr.capacity).toBe(16);
        expect(Array.from(arr.array)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      });
    }
  });
});
