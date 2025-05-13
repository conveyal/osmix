import { assert, describe, it } from "vitest"
import { osmPbfBlobsToBlocksGenerator } from "../src/blobs-to-blocks"
import { createOsmPbfBlobGenerator } from "../src/pbf-to-blobs"
import {
	createSamplePbfFileBytes,
	isHeaderBlock,
	isPrimitiveBlock,
} from "./helpers"

describe("osmPbfBlobsToBlocksGenerator", () => {
	it("consumes asynchronous blob sources", async () => {
		const { header, primitiveBlock, fileBytes } =
			await createSamplePbfFileBytes()
		const collectBlobs = createOsmPbfBlobGenerator()
		const blobs: Uint8Array<ArrayBuffer>[] = []
		for (const blob of collectBlobs(fileBytes)) blobs.push(blob)

		const generator = osmPbfBlobsToBlocksGenerator(
			(async function* () {
				for (const blob of blobs) {
					await Promise.resolve()
					yield blob
				}
			})(),
		)

		const { value: headerBlock, done } = await generator.next()
		assert.isFalse(done)
		if (!isHeaderBlock(headerBlock)) {
			assert.fail("Expected header block")
		}
		assert.deepEqual(headerBlock.bbox, header.bbox)
		assert.deepEqual(headerBlock.required_features, header.required_features)
		assert.deepEqual(headerBlock.optional_features, header.optional_features)

		const { value: block, done: blockDone } = await generator.next()
		assert.isFalse(blockDone)
		if (!isPrimitiveBlock(block)) {
			assert.fail("Expected primitive block")
		}
		assert.lengthOf(block.primitivegroup, primitiveBlock.primitivegroup.length)
		const group = block.primitivegroup[0]
		assert.exists(primitiveBlock.primitivegroup[0])
		assert.exists(group?.dense)
		assert.exists(group?.ways?.[0])
		assert.lengthOf(group.ways, primitiveBlock.primitivegroup[0].ways.length)
		assert.deepEqual(
			group.ways[0].refs,
			primitiveBlock.primitivegroup[0]?.ways?.[0]?.refs,
		)

		const final = await generator.next()
		assert.isTrue(final.done)
	})

	it("accepts synchronous generators", async () => {
		const { fileBytes } = await createSamplePbfFileBytes()
		const collectBlobs = createOsmPbfBlobGenerator()
		const blobs = [...collectBlobs(fileBytes)]
		const generator = osmPbfBlobsToBlocksGenerator(
			(function* () {
				for (const blob of blobs) yield blob
			})(),
		)

		const header = await generator.next()
		assert.isFalse(header.done)
		const block = await generator.next()
		assert.isFalse(block.done)
		const final = await generator.next()
		assert.isTrue(final.done)
	})
})
