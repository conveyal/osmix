import Pbf from "pbf"
import { writeBlob, writeBlobHeader } from "./proto/fileformat"
import { writeHeaderBlock, writePrimitiveBlock } from "./proto/osmformat"
import type { OsmPbfBlock, OsmPbfHeaderBlock } from "./proto/osmformat"
import { compress, concatUint8, uint32BE } from "./utils"

// Recommended and maximum header and blob sizes as defined by the OSM PBF specification
// Header: 32 KiB and 64 KiB
const RECOMMENDED_HEADER_SIZE_BYTES = 32 * 1024
const MAX_HEADER_SIZE_BYTES = 64 * 1024
// Blob: 16 MiB and 32 MiB
const RECOMMENDED_BLOB_SIZE_BYTES = 16 * 1024 * 1024
const MAX_BLOB_SIZE_BYTES = 32 * 1024 * 1024

/**
 * Turn a header block into a blob of bytes.
 * @param headerBlock - The OSM PBF header block.
 * @returns The OsmPbfHeaderBlock as BlobHeader Length, BlobHeader, and Blob as bytes.
 */
export function createOsmHeaderBlob(headerBlock: OsmPbfHeaderBlock) {
	const pbf = new Pbf()
	writeHeaderBlock(headerBlock, pbf)
	return createBlob("OSMHeader", pbf)
}

/**
 * Turn a primitive block into a blob of bytes.
 * @param block - The OSM PBF primitive block.
 * @returns The OsmPbfBlock as BlobHeader Length, BlobHeader, and Blob as bytes.
 */
export function createOsmDataBlob(block: OsmPbfBlock) {
	const pbf = new Pbf()
	writePrimitiveBlock(block, pbf)
	return createBlob("OSMData", pbf)
}

/**
 * Turn a PBF object into a Blob.
 * @param type - The type of the blob.
 * @param contentPbf - The PBF content.
 * @returns The Blob as bytes.
 */
export async function createBlob(
	type: "OSMHeader" | "OSMData",
	contentPbf: Pbf,
) {
	const contentData = contentPbf.finish()
	const raw_size = contentData.length
	const compressedBuffer = await compress(contentData)

	const blobPbf = new Pbf()
	writeBlob(
		{
			raw_size,
			zlib_data: compressedBuffer,
		},
		blobPbf,
	)
	const blob = blobPbf.finish()

	const blobHeaderPbf = new Pbf()
	writeBlobHeader(
		{
			type,
			datasize: blob.length,
		},
		blobHeaderPbf,
	)
	const blobHeader = blobHeaderPbf.finish()
	const blobHeaderSize = uint32BE(blobHeader.byteLength)

	// Check the BlobHeader and Blob sizes, log error if over the recommended size, throw error if over the maximum size
	if (blobHeader.byteLength > RECOMMENDED_HEADER_SIZE_BYTES) {
		const sizeKiB = (blobHeader.byteLength / 1024).toFixed(2)
		if (blobHeader.byteLength > MAX_HEADER_SIZE_BYTES) {
			throw new Error(`BlobHeader is ${sizeKiB} KiB, the maximum size is 64KiB`)
		}
		console.warn(`BlobHeader is ${sizeKiB} KiB, the recommended size is 32KiB`)
	}
	if (blob.byteLength > RECOMMENDED_BLOB_SIZE_BYTES) {
		const sizeMiB = (blob.byteLength / 1024 / 1024).toFixed(2)
		if (blob.byteLength > MAX_BLOB_SIZE_BYTES) {
			throw new Error(`Blob is ${sizeMiB} MiB, the maximum size is 32MiB`)
		}
		console.warn(`Blob is ${sizeMiB} MiB, the recommended size is 16MiB`)
	}

	return concatUint8(blobHeaderSize, blobHeader, blob)
}
