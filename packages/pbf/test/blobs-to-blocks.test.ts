import { describe, expect, it } from "bun:test"
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
		expect(done).toBe(false)
		if (!isHeaderBlock(headerBlock)) {
			throw new Error("Expected header block")
		}
		expect(headerBlock.bbox).toEqual(header.bbox)
		expect(headerBlock.required_features).toEqual(header.required_features)
		expect(headerBlock.optional_features).toEqual(header.optional_features)

		const { value: block, done: blockDone } = await generator.next()
		expect(blockDone).toBe(false)
		if (!isPrimitiveBlock(block)) {
			throw new Error("Expected primitive block")
		}
		expect(block.primitivegroup).toHaveLength(
			primitiveBlock.primitivegroup.length,
		)
		const group = block.primitivegroup[0]
		expect(primitiveBlock.primitivegroup[0]).toBeDefined()
		expect(group?.dense).toBeDefined()
		expect(group?.ways?.[0]).toBeDefined()
		if (!group) throw new Error("group is undefined")
		if (!primitiveBlock.primitivegroup[0])
			throw new Error("primitiveBlock.primitivegroup[0] is undefined")
		expect(group.ways).toHaveLength(
			primitiveBlock.primitivegroup[0].ways.length,
		)
		expect(group.ways[0]?.refs).toEqual(
			primitiveBlock.primitivegroup[0]?.ways?.[0]?.refs,
		)

		const final = await generator.next()
		expect(final.done).toBe(true)
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
		expect(header.done).toBe(false)
		const block = await generator.next()
		expect(block.done).toBe(false)
		const final = await generator.next()
		expect(final.done).toBe(true)
	})
})
