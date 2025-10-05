import Pbf from "pbf"
import { assert, describe, it } from "vitest"
import { osmPbfBlobsToBlocksGenerator } from "../src/blobs-to-blocks"
import { createOsmPbfBlobGenerator } from "../src/pbf-to-blobs"
import { writeBlob, writeBlobHeader } from "../src/proto/fileformat"
import { writeHeaderBlock } from "../src/proto/osmformat"
import { concatUint8, uint32BE } from "../src/utils"
import {
	createSampleHeader,
	createSamplePbfFileBytes,
	isHeaderBlock,
	isPrimitiveBlock,
} from "./helpers"

describe("createOsmPbfBlobGenerator", () => {
	it("yields compressed blobs across fragmented chunks", async () => {
		const { header, primitiveBlock, fileBytes } =
			await createSamplePbfFileBytes()
		const generate = createOsmPbfBlobGenerator()
		const yielded: Uint8Array<ArrayBuffer>[] = []

		let offset = 0
		const chunkSizes = [1, 9]
		for (const size of chunkSizes) {
			const chunk = fileBytes.slice(offset, offset + size)
			offset += size
			for (const blob of generate(chunk)) yielded.push(blob)
		}
		if (offset < fileBytes.length) {
			for (const blob of generate(fileBytes.slice(offset))) yielded.push(blob)
		}

		assert.equal(yielded.length, 2)

		const blocks = osmPbfBlobsToBlocksGenerator(
			(async function* () {
				for (const blob of yielded) yield blob
			})(),
		)
		const { value: headerBlock, done } = await blocks.next()
		assert.isFalse(done)
		if (!isHeaderBlock(headerBlock)) {
			assert.fail("Expected first block to be a header")
		}
		assert.deepEqual(headerBlock.bbox, header.bbox)
		assert.deepEqual(headerBlock.required_features, header.required_features)
		assert.deepEqual(headerBlock.optional_features, header.optional_features)

		const { value: primitive } = await blocks.next()
		if (!isPrimitiveBlock(primitive)) {
			assert.fail("Expected primitive block after header")
		}
		assert.lengthOf(
			primitive.primitivegroup,
			primitiveBlock.primitivegroup.length,
		)
		const dense = primitive.primitivegroup[0].dense
		assert.exists(dense)
		assert.deepEqual(dense?.id, primitiveBlock.primitivegroup[0].dense?.id)
		assert.deepEqual(dense?.lat, primitiveBlock.primitivegroup[0].dense?.lat)
		assert.deepEqual(dense?.lon, primitiveBlock.primitivegroup[0].dense?.lon)
	})

	it("throws when a blob omits zlib data", () => {
		const headerBlock = createSampleHeader()
		const headerPbf = new Pbf()
		writeHeaderBlock(headerBlock, headerPbf)
		const headerContent = headerPbf.finish()

		const blobPbf = new Pbf()
		writeBlob({ raw_size: headerContent.length, raw: headerContent }, blobPbf)
		const blob = blobPbf.finish()

		const blobHeaderPbf = new Pbf()
		writeBlobHeader({ type: "OSMHeader", datasize: blob.length }, blobHeaderPbf)
		const blobHeader = blobHeaderPbf.finish()

		const chunk = concatUint8(uint32BE(blobHeader.byteLength), blobHeader, blob)
		const generate = createOsmPbfBlobGenerator()
		const iterator = generate(chunk)
		assert.throws(() => iterator.next(), /Blob has no zlib data/)
	})
})
