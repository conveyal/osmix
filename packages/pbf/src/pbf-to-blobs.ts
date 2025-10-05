import Pbf from "pbf"
import { HEADER_LENGTH_BYTES } from "./pbf-to-blocks"
import {
	type OsmPbfBlobHeader,
	readBlob,
	readBlobHeader,
} from "./proto/fileformat"

/**
 * Create a generator that takes ArrayBuffer chunks and yields compressed OSM PBF Blobs. This tracks the state of the parser
 * and allows for incremental parsing of incoming data. The first value yielded is the file header. Subsequent values are
 * primitive blocks. This function is written to be used both with generators and streams.
 *
 * Leaves decompression and block parsing to the caller.
 */

export function createOsmPbfBlobGenerator() {
	let pbf: Pbf = new Pbf(new Uint8Array(0))
	let state: "header-length" | "header" | "blob" = "header-length"
	let bytesNeeded: number = HEADER_LENGTH_BYTES
	let blobHeader: OsmPbfBlobHeader | null = null

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
