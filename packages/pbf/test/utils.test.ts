import { describe, expect, it } from "bun:test"
import {
	concatUint8,
	toAsyncGenerator,
	uint32BE,
	webCompress,
	webDecompress,
} from "../src/utils"

describe("utils", () => {
	it("wraps values into an async generator", async () => {
		const generator = toAsyncGenerator(3)
		const first = await generator.next()
		expect(first).toEqual({ value: 3, done: false })
		const done = await generator.next()
		expect(done).toEqual({ value: undefined, done: true })
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
		expect(values).toEqual([1, 2])
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
		expect(concatUint8(a, b)).toEqual(Uint8Array.of(1, 2, 3))
	})

	it("encodes big-endian 32-bit integers", () => {
		expect(uint32BE(0x01020304)).toEqual(Uint8Array.of(1, 2, 3, 4))
	})

	it("compresses and decompresses data", async () => {
		const input = new TextEncoder().encode("osmix") as Uint8Array<ArrayBuffer>
		const compressed = await webCompress(input)
		expect(compressed).not.toEqual(input)
		const decompressed = await webDecompress(compressed)
		expect(decompressed).toEqual(input)
	})
})
