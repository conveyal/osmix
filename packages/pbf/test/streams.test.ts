import { assert, describe, expect, it } from "vitest"
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

		assert.deepEqual(concatUint8(...chunks), fileBytes)
	})

	it("parses streamed bytes back into header and primitive blocks", async () => {
		const { header, primitiveBlock, fileBytes } =
			await createSamplePbfFileBytes()
		assert.exists(primitiveBlock.primitivegroup[0])
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

		assert.equal(blocks.length, 2)
		const headerBlock = blocks[0]
		if (!isHeaderBlock(headerBlock)) {
			assert.fail("Expected header block")
		}
		assert.deepEqual(headerBlock.bbox, header.bbox)
		assert.deepEqual(headerBlock.required_features, header.required_features)
		const block = blocks[1]
		if (!isPrimitiveBlock(block)) {
			assert.fail("Expected primitive block")
		}
		assert.lengthOf(block.primitivegroup, primitiveBlock.primitivegroup.length)
		assert.exists(block.primitivegroup)
		assert.exists(block.primitivegroup[0])
		const dense = block.primitivegroup[0].dense
		assert.exists(dense)
		assert.deepEqual(dense.id, primitiveBlock.primitivegroup[0].dense?.id)
	})
})
