import { describe, expect, test } from "bun:test"
import "../src/compression-stream-polyfill"
import {
	compress,
	concatUint8,
	decompress,
	toAsyncGenerator,
	uint32BE,
} from "../src/utils"

describe("utils", () => {
	test("wraps values into an async generator", async () => {
		const generator = toAsyncGenerator(3)
		const first = await generator.next()
		expect(first).toEqual({ value: 3, done: false })
		const done = await generator.next()
		expect(done).toEqual({ value: undefined, done: true })
	})

	test("consumes readable streams", async () => {
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

	test("throws on nullish inputs", async () => {
		const invalidInput = null as unknown as never
		await expect(toAsyncGenerator(invalidInput).next()).rejects.toThrow(
			"Value is null",
		)
	})

	test("concatenates Uint8Array segments", () => {
		const a = Uint8Array.of(1, 2)
		const b = Uint8Array.of(3)
		expect(concatUint8(a, b)).toEqual(Uint8Array.of(1, 2, 3))
	})

	test("encodes big-endian 32-bit integers", () => {
		expect(uint32BE(0x01020304)).toEqual(Uint8Array.of(1, 2, 3, 4))
	})

	test("compresses and decompresses data with deflate", async () => {
		const input = new TextEncoder().encode("osmix")
		const compressed = await compress(input)
		expect(compressed).not.toEqual(input)
		const decompressed = await decompress(compressed)
		expect(decompressed).toEqual(input)
	})

	test("compresses and decompresses data with gzip", async () => {
		const input = new TextEncoder().encode("osmix with gzip compression")
		const compressed = await compress(input, "gzip")
		expect(compressed).not.toEqual(input)
		const decompressed = await decompress(compressed, "gzip")
		expect(decompressed).toEqual(input)
	})

	test("compresses and decompresses larger data", async () => {
		const input = new TextEncoder().encode("a".repeat(1000))
		const compressed = await compress(input)
		expect(compressed.length).toBeLessThan(input.length)
		const decompressed = await decompress(compressed)
		expect(decompressed).toEqual(input)
	})

	test("handles Uint8Array input", async () => {
		const input = Uint8Array.of(1, 2, 3, 4, 5)
		const compressed = await compress(input)
		const decompressed = await decompress(compressed)
		expect(decompressed).toEqual(input)
	})

	test("handles string input", async () => {
		const input = "test string"
		const compressed = await compress(input)
		const decompressed = await decompress(compressed)
		expect(new TextDecoder().decode(decompressed)).toBe(input)
	})

	test("uses Bun runtime with Node.js zlib compatibility", () => {
		// This test verifies that Bun is available in the runtime
		expect(typeof Bun).toBe("object")
	})

	test("Node.js zlib methods work in Bun", async () => {
		const { deflateSync, inflateSync } = await import("node:zlib")
		const input = new TextEncoder().encode("test bun compression with zlib")
		const compressed = deflateSync(input)
		expect(compressed.length).toBeGreaterThan(0)
		expect(compressed).not.toEqual(input)

		const decompressed = inflateSync(compressed)
		expect(decompressed).toEqual(input as Buffer)
	})

	test("compress/decompress are compatible with OSM PBF zlib format", async () => {
		// Test that our compress/decompress functions produce zlib-compatible data
		// This is critical for OSM PBF compatibility
		const { deflateSync, inflateSync } = await import("node:zlib")
		const input = new TextEncoder().encode(
			"OSM PBF uses zlib format (deflate with headers)",
		)

		// Compress with our function
		const ourCompressed = await compress(input)

		// Decompress with Node.js zlib (what OSM PBF uses)
		const decompressedWithNodeZlib = inflateSync(ourCompressed)
		expect(decompressedWithNodeZlib).toEqual(input as Buffer)

		// Compress with Node.js zlib
		const nodeCompressed = deflateSync(input)

		// Decompress with our function
		const decompressedWithOurs = await decompress(new Uint8Array(nodeCompressed))
		expect(decompressedWithOurs).toEqual(input)
	})
})

describe("CompressionStream polyfill", () => {
	test("compresses data using deflate format", async () => {
		const input = new TextEncoder().encode("test compression stream")
		const compressor = new CompressionStream("deflate")
		
		const writer = compressor.writable.getWriter()
		writer.write(input)
		writer.close()

		const chunks: Uint8Array[] = []
		const reader = compressor.readable.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value)
		}

		const compressed = concatUint8(...chunks)
		expect(compressed.length).toBeGreaterThan(0)
		expect(compressed).not.toEqual(input)

		// Verify it's valid deflate data by decompressing
		const decompressed = await decompress(new Uint8Array(compressed))
		expect(decompressed).toEqual(input)
	})

	test("compresses data using gzip format", async () => {
		const input = new TextEncoder().encode("test gzip stream")
		const compressor = new CompressionStream("gzip")
		
		const writer = compressor.writable.getWriter()
		writer.write(input)
		writer.close()

		const chunks: Uint8Array[] = []
		const reader = compressor.readable.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value)
		}

		const compressed = concatUint8(...chunks)
		const decompressed = await decompress(new Uint8Array(compressed), "gzip")
		expect(decompressed).toEqual(input)
	})

	test("returns proper Uint8Array<ArrayBuffer> instances", async () => {
		const input = new TextEncoder().encode("type safety check")
		const compressor = new CompressionStream("deflate")
		
		const writer = compressor.writable.getWriter()
		writer.write(input)
		writer.close()

		const reader = compressor.readable.getReader()
		const { value } = await reader.read()
		
		expect(value).toBeDefined()
		if (!value) throw new Error("No value read")
		
		// Verify it's a Uint8Array
		expect(value).toBeInstanceOf(Uint8Array)
		// Verify the buffer is an ArrayBuffer (not Buffer or SharedArrayBuffer)
		expect(value.buffer).toBeInstanceOf(ArrayBuffer)
		// Verify it's not a Node.js Buffer
		expect(value.constructor.name).toBe("Uint8Array")
	})

	test("handles multiple writes", async () => {
		const compressor = new CompressionStream("deflate")
		const writer = compressor.writable.getWriter()
		
		// Write multiple chunks
		writer.write(new TextEncoder().encode("first "))
		writer.write(new TextEncoder().encode("second "))
		writer.write(new TextEncoder().encode("third"))
		writer.close()

		const chunks: Uint8Array[] = []
		const reader = compressor.readable.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value)
		}

		const compressed = concatUint8(...chunks)
		const decompressed = await decompress(new Uint8Array(compressed))
		expect(new TextDecoder().decode(decompressed)).toBe("first second third")
	})
})

describe("DecompressionStream polyfill", () => {
	test("decompresses deflate data", async () => {
		const input = new TextEncoder().encode("test decompression stream")
		const compressed = await compress(input, "deflate")
		
		const decompressor = new DecompressionStream("deflate")
		const writer = decompressor.writable.getWriter()
		writer.write(compressed)
		writer.close()

		const chunks: Uint8Array[] = []
		const reader = decompressor.readable.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value)
		}

		const decompressed = concatUint8(...chunks)
		expect(decompressed).toEqual(input)
	})

	test("decompresses gzip data", async () => {
		const input = new TextEncoder().encode("test gzip decompression")
		const compressed = await compress(input, "gzip")
		
		const decompressor = new DecompressionStream("gzip")
		const writer = decompressor.writable.getWriter()
		writer.write(compressed)
		writer.close()

		const chunks: Uint8Array[] = []
		const reader = decompressor.readable.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value)
		}

		const decompressed = concatUint8(...chunks)
		expect(decompressed).toEqual(input)
	})

	test("returns proper Uint8Array<ArrayBuffer> instances", async () => {
		const input = new TextEncoder().encode("type safety check")
		const compressed = await compress(input)
		
		const decompressor = new DecompressionStream("deflate")
		const writer = decompressor.writable.getWriter()
		writer.write(compressed)
		writer.close()

		const reader = decompressor.readable.getReader()
		const { value } = await reader.read()
		
		expect(value).toBeDefined()
		if (!value) throw new Error("No value read")
		
		// Verify it's a Uint8Array
		expect(value).toBeInstanceOf(Uint8Array)
		// Verify the buffer is an ArrayBuffer (not Buffer or SharedArrayBuffer)
		expect(value.buffer).toBeInstanceOf(ArrayBuffer)
		// Verify it's not a Node.js Buffer
		expect(value.constructor.name).toBe("Uint8Array")
	})

	test("handles chunked compressed data", async () => {
		const input = new TextEncoder().encode("test chunked data")
		const compressed = await compress(input)
		
		const decompressor = new DecompressionStream("deflate")
		const writer = decompressor.writable.getWriter()
		
		// Write compressed data in chunks
		const chunkSize = 5
		for (let i = 0; i < compressed.length; i += chunkSize) {
			const chunk = compressed.slice(i, i + chunkSize)
			writer.write(chunk)
		}
		writer.close()

		const chunks: Uint8Array[] = []
		const reader = decompressor.readable.getReader()
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value)
		}

		const decompressed = concatUint8(...chunks)
		expect(decompressed).toEqual(input)
	})

	test("round-trip compression and decompression", async () => {
		const input = new TextEncoder().encode("round trip test data")
		
		// Compress
		const compressor = new CompressionStream("deflate")
		const compressorWriter = compressor.writable.getWriter()
		compressorWriter.write(input)
		compressorWriter.close()

		const compressedChunks: Uint8Array[] = []
		const compressorReader = compressor.readable.getReader()
		while (true) {
			const { done, value } = await compressorReader.read()
			if (done) break
			compressedChunks.push(value)
		}
		const compressed = concatUint8(...compressedChunks)

		// Decompress
		const decompressor = new DecompressionStream("deflate")
		const decompressorWriter = decompressor.writable.getWriter()
		decompressorWriter.write(new Uint8Array(compressed))
		decompressorWriter.close()

		const decompressedChunks: Uint8Array[] = []
		const decompressorReader = decompressor.readable.getReader()
		while (true) {
			const { done, value } = await decompressorReader.read()
			if (done) break
			decompressedChunks.push(value)
		}
		const decompressed = concatUint8(...decompressedChunks)

		expect(decompressed).toEqual(input)
	})
})

