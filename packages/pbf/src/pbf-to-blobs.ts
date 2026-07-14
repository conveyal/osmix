import { PbfReader } from "pbf";

import { HEADER_LENGTH_BYTES } from "./pbf-to-blocks.ts";
import { type OsmPbfBlobHeader, readBlob, readBlobHeader } from "./proto/fileformat.ts";
import { MAX_BLOB_SIZE_BYTES, MAX_HEADER_SIZE_BYTES } from "./spec.ts";

export type OsmPbfBlobFrame = {
  data: Uint8Array<ArrayBuffer>;
  rawSize?: number;
};

const invalidFrame = (message: string): Error => new Error(`Invalid PBF frame: ${message}`);

/**
 * Create the internal parser for framed PBF blobs.
 *
 * The parser retains the declared raw size so readers can enforce decompression
 * budgets without reparsing the blob headers. Call `finish()` after the input
 * ends to reject an incomplete prefix, header, or blob.
 */
export function createOsmPbfBlobFrameGenerator() {
  let pbf: PbfReader = new PbfReader(new Uint8Array(0));
  let state: "header-length" | "header" | "blob" = "header-length";
  let bytesNeeded = HEADER_LENGTH_BYTES;
  let blobHeader: OsmPbfBlobHeader | null = null;

  const nextChunk = function* (chunk: Uint8Array | ArrayBufferLike): Generator<OsmPbfBlobFrame> {
    const chunkBytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const currentBuffer = pbf.buf.subarray(pbf.pos);
    if (currentBuffer.byteLength === 0) {
      pbf = new PbfReader(chunkBytes);
    } else {
      const tmpBuffer = new Uint8Array(currentBuffer.byteLength + chunkBytes.byteLength);
      tmpBuffer.set(currentBuffer);
      tmpBuffer.set(chunkBytes, currentBuffer.byteLength);
      pbf = new PbfReader(tmpBuffer);
    }

    while (pbf.pos + bytesNeeded <= pbf.length) {
      if (state === "header-length") {
        const dataView = new DataView(pbf.buf.buffer, pbf.buf.byteOffset, pbf.buf.byteLength);
        const headerSize = dataView.getUint32(pbf.pos, false);
        if (headerSize === 0) throw invalidFrame("header length is zero");
        if (headerSize > MAX_HEADER_SIZE_BYTES) {
          throw invalidFrame(`header length exceeds ${MAX_HEADER_SIZE_BYTES} bytes`);
        }
        pbf.pos += HEADER_LENGTH_BYTES;
        bytesNeeded = headerSize;
        state = "header";
      } else if (state === "header") {
        blobHeader = readBlobHeader(pbf, pbf.pos + bytesNeeded);
        if (blobHeader.datasize === 0) throw invalidFrame("blob size is zero");
        if (blobHeader.datasize > MAX_BLOB_SIZE_BYTES) {
          throw invalidFrame(`blob size exceeds ${MAX_BLOB_SIZE_BYTES} bytes`);
        }
        bytesNeeded = blobHeader.datasize;
        state = "blob";
      } else {
        if (blobHeader == null) throw Error("Blob header has not been read");
        const blob = readBlob(pbf, pbf.pos + bytesNeeded);
        if (blob.zlib_data === undefined || blob.zlib_data.length === 0) {
          throw Error("Blob has no zlib data. Format is unsupported.");
        }
        if (blob.raw_size === 0) throw invalidFrame("raw size is zero");
        if (blob.raw_size != null && blob.raw_size > MAX_BLOB_SIZE_BYTES) {
          throw invalidFrame(`raw size exceeds ${MAX_BLOB_SIZE_BYTES} bytes`);
        }

        yield {
          data: blob.zlib_data as Uint8Array<ArrayBuffer>,
          rawSize: blob.raw_size && blob.raw_size > 0 ? blob.raw_size : undefined,
        };

        state = "header-length";
        bytesNeeded = HEADER_LENGTH_BYTES;
        blobHeader = null;
      }
    }
  };

  const finish = () => {
    if (state !== "header-length" || pbf.pos !== pbf.length) {
      throw invalidFrame(`truncated ${state}`);
    }
  };

  return { nextChunk, finish };
}

/**
 * Create a stateful parser that extracts compressed blobs from raw PBF bytes.
 *
 * OSM PBF files consist of length-prefixed blobs. This function returns a generator
 * that accumulates incoming byte chunks and yields complete compressed blobs as they
 * become available. The caller is responsible for decompression.
 *
 * The first yielded blob contains the file header; subsequent blobs contain primitive data.
 *
 * @returns A generator function that accepts byte chunks and yields blob payloads.
 */
export function createOsmPbfBlobGenerator() {
  const parser = createOsmPbfBlobFrameGenerator();

  return function* nextChunk(chunk: Uint8Array | ArrayBufferLike) {
    for (const frame of parser.nextChunk(chunk)) yield frame.data;
  };
}
