import { describe, expect, it } from "bun:test"
import { OsmBlocksToPbfBytesTransformStream } from "../src/blocks-to-pbf"
import { OsmPbfBytesToBlocksTransformStream } from "../src/pbf-to-blocks"
import { concatUint8 } from "../src/utils"
import {
	createSamplePbfFileBytes,
	createSamplePrimitiveBlock,
	isHeaderBlock,
	isPrimitiveBlock,
} from "./helpers"

describe("transform streams", () => {
	it("requires the header to be written before data blocks", async () => {
		const input = new ReadableStream({
			start(controller) {
				controller.enqueue(createSamplePrimitiveBlock())
				controller.close()
			},
		})

		await expect(
			input
				.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
				.pipeTo(new WritableStream()),
		).rejects.toThrow("Header first in ReadableStream of blocks.")
	})

	it("serialises blocks into the expected PBF byte sequence", async () => {
		const { header, primitiveBlock, fileBytes } =
			await createSamplePbfFileBytes()
		const chunks: Uint8Array[] = []

		const input = new ReadableStream({
			start(controller) {
				controller.enqueue(header)
				controller.enqueue(primitiveBlock)
				controller.close()
			},
		})

		await input.pipeThrough(new OsmBlocksToPbfBytesTransformStream()).pipeTo(
			new WritableStream<Uint8Array>({
				write(chunk) {
					chunks.push(chunk)
				},
			}),
		)

		expect(concatUint8(...chunks)).toEqual(fileBytes)
	})

	it("parses streamed bytes back into header and primitive blocks", async () => {
		const { header, primitiveBlock, fileBytes } =
			await createSamplePbfFileBytes()
		expect(primitiveBlock.primitivegroup[0]).toBeDefined()
		const blocks: unknown[] = []

		const input = new ReadableStream({
			start(controller) {
				controller.enqueue(fileBytes.slice(0, 7).buffer)
				controller.enqueue(fileBytes.slice(7).buffer)
				controller.close()
			},
		})

		await input.pipeThrough(new OsmPbfBytesToBlocksTransformStream()).pipeTo(
			new WritableStream({
				write(chunk) {
					blocks.push(chunk)
				},
			}),
		)

		expect(blocks.length).toBe(2)
		const headerBlock = blocks[0]
		if (!isHeaderBlock(headerBlock)) {
			throw new Error("Expected header block")
		}
		expect(headerBlock.bbox).toEqual(header.bbox)
		expect(headerBlock.required_features).toEqual(header.required_features)
		const block = blocks[1]
		if (!isPrimitiveBlock(block)) {
			throw new Error("Expected primitive block")
		}
		expect(block.primitivegroup).toHaveLength(
			primitiveBlock.primitivegroup.length,
		)
		expect(block.primitivegroup).toBeDefined()
		expect(block.primitivegroup[0]).toBeDefined()
		if (!block.primitivegroup[0])
			throw new Error("block.primitivegroup[0] is undefined")
		if (!primitiveBlock.primitivegroup[0])
			throw new Error("primitiveBlock.primitivegroup[0] is undefined")
		const dense = block.primitivegroup[0].dense
		expect(dense).toBeDefined()
		if (!dense) throw new Error("dense is undefined")
		if (!primitiveBlock.primitivegroup[0]?.dense)
			throw new Error("primitiveBlock.primitivegroup[0].dense is undefined")
		expect(dense.id).toEqual(primitiveBlock.primitivegroup[0].dense.id)
	})
})
