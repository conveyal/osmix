import { assert, describe, expect, it } from "vitest"
import {
	compress,
	concatUint8,
	decompress,
	toAsyncGenerator,
	uint32BE,
} from "../src/utils"

describe("utils", () => {
	it("wraps values into an async generator", async () => {
		const generator = toAsyncGenerator(3)
		const first = await generator.next()
		assert.deepEqual(first, { value: 3, done: false })
		const done = await generator.next()
		assert.deepEqual(done, { value: undefined, done: true })
	})

	it("consumes readable streams", async () => {
		const stream = new ReadableStream<number>({
			start(controller) {
				controller.enqueue(1)
				controller.enqueue(2)
				controller.close()
			},
		})
		const values: number[] = []
		for await (const value of toAsyncGenerator(stream)) values.push(value)
		assert.deepEqual(values, [1, 2])
	})

	it("throws on nullish inputs", async () => {
		const invalidInput = null as unknown as never
		await expect(toAsyncGenerator(invalidInput).next()).rejects.toThrow(
			"Value is null",
		)
	})

	it("concatenates Uint8Array segments", () => {
		const a = Uint8Array.of(1, 2)
		const b = Uint8Array.of(3)
		assert.deepEqual(concatUint8(a, b), Uint8Array.of(1, 2, 3))
	})

	it("encodes big-endian 32-bit integers", () => {
		assert.deepEqual(uint32BE(0x01020304), Uint8Array.of(1, 2, 3, 4))
	})

	it("compresses and decompresses data", async () => {
		const input = new TextEncoder().encode("osmix")
		const compressed = await compress(input)
		assert.notDeepEqual(compressed, input)
		const decompressed = await decompress(compressed)
		assert.deepEqual(decompressed, input)
	})
})
