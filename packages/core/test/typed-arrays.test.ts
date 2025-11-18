import { describe, expect, it } from "bun:test"
import { BufferConstructor, ResizeableTypedArray } from "../src/typed-arrays"

describe("typed array helpers", () => {
	it("selects the appropriate buffer constructor", () => {
		if (typeof SharedArrayBuffer !== "undefined") {
			expect(BufferConstructor).toBe(SharedArrayBuffer)
		} else {
			expect(BufferConstructor).toBe(ArrayBuffer)
		}
	})

	describe("ResizeableTypedArray", () => {
		it("push stores values and returns the index", () => {
			const arr = new ResizeableTypedArray(Float64Array)

			const first = arr.push(1.5)
			const second = arr.push(2.5)

			expect(first).toBe(0)
			expect(second).toBe(1)
			expect(arr.length).toBe(2)
			expect(arr.at(0)).toBe(1.5)
			expect(arr.at(1)).toBe(2.5)
		})

		it("should push many values", () => {
			const arr = new ResizeableTypedArray(Float64Array)

			arr.pushMany([1.5, 2.5])

			expect(arr.length).toBe(2)
			expect(arr.at(0)).toBe(1.5)
			expect(arr.at(1)).toBe(2.5)
		})

		it("at supports negative indices and guards bounds", () => {
			const arr = new ResizeableTypedArray(Int16Array)

			arr.pushMany([10, 20, 30])

			expect(arr.length).toBe(3)
			expect(Array.from(arr.slice(0, arr.length))).toEqual([10, 20, 30])
			expect(arr.at(-1)).toBe(30)
			expect(arr.at(-3)).toBe(10)
			expect(() => arr.at(-4)).toThrow(/Index out of bounds/)
			expect(() => arr.at(3)).toThrow(/Index out of bounds/)
		})

		it("pushMany appends arrays while preserving order", () => {
			const arr = new ResizeableTypedArray(Uint32Array)

			arr.pushMany([1, 2, 3])
			arr.pushMany(Uint32Array.from([4, 5]))

			expect(arr.length).toBe(5)
			expect(Array.from(arr.slice(0, arr.length))).toEqual([1, 2, 3, 4, 5])
		})

		it("slice returns a copy of the requested segment", () => {
			const arr = new ResizeableTypedArray(Uint8Array)

			arr.pushMany([1, 2, 3, 4])

			const segment = arr.slice(1, 3)

			expect(segment).toBeInstanceOf(Uint8Array)
			expect(Array.from(segment)).toEqual([2, 3])

			segment[0] = 99
			expect(arr.at(1)).toBe(2)
		})

		it("compact trims unused capacity", () => {
			const arr = new ResizeableTypedArray(Float64Array)

			arr.pushMany([5, 6, 7])

			const previousCapacity = arr.array.length
			const compacted = arr.compact()
			const expectedByteLength = arr.length * Float64Array.BYTES_PER_ELEMENT

			expect(compacted).toBe(arr.array)
			expect(compacted.length).toBe(arr.length)
			expect(compacted.length).toBeLessThan(previousCapacity)
			expect(arr.array.buffer.byteLength).toBe(expectedByteLength)
		})

		it("from reuses an existing buffer and grows when needed", () => {
			const backing = new ArrayBuffer(16)
			new Uint32Array(backing).set([1, 2, 3, 4])

			const arr = ResizeableTypedArray.from(Uint32Array, backing)

			arr.bufferSize = arr.buffer.byteLength
			arr.maxByteLength = Math.max(arr.maxByteLength, arr.bufferSize * 2)
			arr.items = arr.array.length

			expect(arr.length).toBe(4)
			expect(Array.from(arr.slice(0, arr.length))).toEqual([1, 2, 3, 4])

			arr.push(5)

			expect(arr.length).toBe(5)
			expect(arr.array.length).toBe(8)
			expect(Array.from(arr.slice(0, arr.length))).toEqual([1, 2, 3, 4, 5])
		})

		if (typeof SharedArrayBuffer !== "undefined") {
			it("grows shared buffers in place", () => {
				const backing = new SharedArrayBuffer(8, {
					maxByteLength: 32,
				})
				const seed = new Uint8Array(backing)
				seed.set([1, 2, 3, 4, 5, 6, 7, 8])

				const arr = ResizeableTypedArray.from(Uint8Array, backing)

				arr.bufferSize = arr.buffer.byteLength
				arr.maxByteLength = backing.maxByteLength
				arr.items = arr.array.length

				const originalBuffer = arr.buffer

				arr.push(9)

				expect(arr.buffer).toBe(originalBuffer)
				expect(arr.array.length).toBe(16)
				expect(arr.buffer.byteLength).toBe(16)
				expect(Array.from(arr.slice(0, 9))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
			})
		}
	})
})
