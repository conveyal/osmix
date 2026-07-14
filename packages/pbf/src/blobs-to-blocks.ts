/**
 * Blob-to-block conversion utilities.
 *
 * Handles decompression and protobuf decoding of raw OSM PBF blobs into
 * typed header and primitive block structures.
 *
 * @module
 */

import { PbfReader } from "pbf";

import { type OsmPbfBlobFrame } from "./pbf-to-blobs.ts";
import {
  type OsmPbfBlock,
  type OsmPbfHeaderBlock,
  readHeaderBlock,
  readPrimitiveBlock,
} from "./proto/osmformat.ts";
import { MAX_BLOB_SIZE_BYTES } from "./spec.ts";
import { webDecompress } from "./utils.ts";

type CompressedBlob = Uint8Array<ArrayBuffer> | OsmPbfBlobFrame;
type Decompress = (
  data: Uint8Array<ArrayBuffer>,
  maxBytes?: number,
) => Promise<Uint8Array<ArrayBuffer>>;

function frameData(blob: CompressedBlob): OsmPbfBlobFrame {
  return blob instanceof Uint8Array ? { data: blob } : blob;
}

async function decompressBlob(
  blob: OsmPbfBlobFrame,
  decompress: Decompress,
): Promise<Uint8Array<ArrayBuffer>> {
  const decompressed = await decompress(blob.data, MAX_BLOB_SIZE_BYTES);
  if (decompressed.byteLength > MAX_BLOB_SIZE_BYTES) {
    throw Error(`Decompressed blob exceeds ${MAX_BLOB_SIZE_BYTES} bytes`);
  }
  if (blob.rawSize !== undefined && decompressed.byteLength !== blob.rawSize) {
    throw Error(
      `Decompressed blob size ${decompressed.byteLength} does not match declared raw size ${blob.rawSize}`,
    );
  }
  return decompressed;
}

/**
 * Decompress and decode a stream of raw PBF blobs into typed blocks.
 *
 * This async generator handles the transition from compressed bytes to parsed
 * protobuf structures. The first blob is always decoded as a header block;
 * subsequent blobs are decoded as primitive blocks containing OSM entities.
 *
 * @param blobs - Async or sync generator yielding compressed blob payloads.
 * @param decompress - Optional decompression function (defaults to Web Streams zlib).
 * @yields Header block first, then primitive blocks.
 *
 * @example
 * ```ts
 * import { osmPbfBlobsToBlocksGenerator, createOsmPbfBlobGenerator } from "@osmix/pbf"
 *
 * const generateBlobs = createOsmPbfBlobGenerator()
 * const blobsGen = (async function* () {
 *   for await (const chunk of stream) {
 *     yield* generateBlobs(chunk)
 *   }
 * })()
 *
 * for await (const block of osmPbfBlobsToBlocksGenerator(blobsGen)) {
 *   // First iteration yields header, rest yield primitive blocks
 * }
 * ```
 */
export async function* osmPbfBlobsToBlocksGenerator(
  blobs:
    | AsyncGenerator<CompressedBlob>
    | Generator<CompressedBlob>
    | AsyncGenerator<Uint8Array<ArrayBuffer>>
    | Generator<Uint8Array<ArrayBuffer>>,
  decompress: Decompress = webDecompress,
) {
  let headerRead = false;
  for await (const blob of blobs) {
    const frame = frameData(blob);
    if (!headerRead) {
      headerRead = true;
      yield readOsmHeaderBlock(frame, decompress);
    } else {
      yield readOsmPrimitiveBlock(frame, decompress);
    }
  }
}

/**
 * Decompress and parse a header block from a compressed blob.
 *
 * @param compressedBlob - Zlib-compressed protobuf header blob.
 * @param decompress - Optional decompression function.
 * @returns Parsed header block with required/optional features and bbox.
 */
export async function readOsmHeaderBlock(
  compressedBlob: CompressedBlob,
  decompress: Decompress = webDecompress,
): Promise<OsmPbfHeaderBlock> {
  const decompressedBlob = await decompressBlob(frameData(compressedBlob), decompress);
  const pbf = new PbfReader(decompressedBlob);
  return readHeaderBlock(pbf);
}

/**
 * Decompress and parse a primitive block from a compressed blob.
 *
 * @param compressedBlob - Zlib-compressed protobuf primitive blob.
 * @param decompress - Optional decompression function.
 * @returns Parsed primitive block with string table and primitive groups.
 */
export async function readOsmPrimitiveBlock(
  compressedBlob: CompressedBlob,
  decompress: Decompress = webDecompress,
): Promise<OsmPbfBlock> {
  const decompressedBlob = await decompressBlob(frameData(compressedBlob), decompress);
  const pbf = new PbfReader(decompressedBlob);
  return readPrimitiveBlock(pbf);
}
