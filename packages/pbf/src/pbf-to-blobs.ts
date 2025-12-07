import Pbf from "pbf"
import { HEADER_LENGTH_BYTES } from "./pbf-to-blocks"
import {
	type OsmPbfBlobHeader,
	readBlob,
	readBlobHeader,
} from "./proto/fileformat"

/**
 * Create a stateful parser that extracts compressed blobs from raw PBF bytes.
 *
 * OSM PBF files consist of length-prefixed blobs. This function returns a generator
 * that accumulates incoming byte chunks and yields complete compressed blobs as they
 * become available. The caller is responsible for decompression.
 *
 * The first yielded blob contains the file header; subsequent blobs contain primitive data.
 *
 * @returns A generator function that accepts byte chunks and yields compressed blob payloads.
 *
 * @example
 * ```ts
 * import { createOsmPbfBlobGenerator } from "@osmix/pbf"
 *
 * const generateBlobs = createOsmPbfBlobGenerator()
 *
 * for await (const chunk of stream) {
 *   for (const compressedBlob of generateBlobs(chunk)) {
 *     // Decompress and parse blob...
 *   }
 * }
 * ```
 */
export function createOsmPbfBlobGenerator() {
	let pbf: Pbf = new Pbf(new Uint8Array(0))
	let state: "header-length" | "header" | "blob" = "header-length"
	let bytesNeeded: number = HEADER_LENGTH_BYTES
	let blobHeader: OsmPbfBlobHeader | null = null

	/**
	 * Feed the parser with the next chunk of bytes and yield any complete compressed blobs.
	 * @param chunk - Raw bytes from the PBF file.
	 * @yields Compressed blob payloads (zlib-compressed protobuf data).
	 */
	return function* nextChunk(chunk: Uint8Array) {
		const currentBuffer: Uint8Array = pbf.buf.slice(pbf.pos)
		const tmpBuffer = new Uint8Array(
			currentBuffer.buffer.byteLength + chunk.byteLength,
		)
		tmpBuffer.set(currentBuffer.subarray(0))
		tmpBuffer.set(new Uint8Array(chunk), currentBuffer.byteLength)
		pbf = new Pbf(tmpBuffer)

		while (pbf.pos + bytesNeeded <= pbf.length) {
			if (state === "header-length") {
				const dataView = new DataView(pbf.buf.buffer)
				bytesNeeded = dataView.getInt32(pbf.pos, false) // network byte order
				pbf.pos += HEADER_LENGTH_BYTES
				state = "header"
			} else if (state === "header") {
				blobHeader = readBlobHeader(pbf, pbf.pos + bytesNeeded)
				bytesNeeded = blobHeader.datasize
				state = "blob"
			} else if (state === "blob") {
				if (blobHeader == null) throw Error("Blob header has not been read")
				const blob = readBlob(pbf, pbf.pos + bytesNeeded)
				if (blob.zlib_data === undefined || blob.zlib_data.length === 0)
					throw Error("Blob has no zlib data. Format is unsupported.")

				yield blob.zlib_data as Uint8Array<ArrayBuffer>

				state = "header-length"
				bytesNeeded = HEADER_LENGTH_BYTES
				blobHeader = null
			}
		}
	}
}
