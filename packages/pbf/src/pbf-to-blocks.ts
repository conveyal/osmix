import { PbfReader } from "pbf";

import { osmPbfBlobsToBlocksGenerator } from "./blobs-to-blocks.ts";
import { createOsmPbfBlobFrameGenerator } from "./pbf-to-blobs.ts";
import {
  type OsmPbfBlock,
  type OsmPbfHeaderBlock,
  readHeaderBlock,
  readPrimitiveBlock,
} from "./proto/osmformat.ts";
import { MAX_BLOB_SIZE_BYTES } from "./spec.ts";
import { type AsyncGeneratorValue, toAsyncGenerator, webDecompress } from "./utils.ts";

/** Number of bytes used to encode the BlobHeader length prefix (big-endian uint32). */
export const HEADER_LENGTH_BYTES = 4;

/**
 * Parse an OSM PBF file from various input sources.
 *
 * Accepts `ArrayBuffer`, `Uint8Array`, `ReadableStream<Uint8Array>`, or async generators.
 * Returns the file header and a lazy async generator of primitive blocks for on-demand parsing.
 *
 * @param data - PBF bytes as buffer, stream, or async iterable.
 * @returns Object with `header` (file metadata) and `blocks` (async generator of primitive blocks).
 * @throws If the header block is missing or malformed.
 *
 * @example
 * ```ts
 * import { readOsmPbf } from "@osmix/pbf"
 *
 * // From a file stream
 * const { header, blocks } = await readOsmPbf(Bun.file('./monaco.pbf').stream())
 *
 * // From a fetch response
 * const response = await fetch('/data/monaco.pbf')
 * const { header, blocks } = await readOsmPbf(response.body!)
 *
 * // Iterate blocks lazily
 * for await (const block of blocks) {
 *   for (const group of block.primitivegroup) {
 *     console.log(group.dense?.id.length ?? 0, "dense nodes")
 *   }
 * }
 * ```
 */
export async function readOsmPbf(data: AsyncGeneratorValue<Uint8Array<ArrayBufferLike>>) {
  const parser = createOsmPbfBlobFrameGenerator();
  const blocks = osmPbfBlobsToBlocksGenerator(
    (async function* () {
      for await (const chunk of toAsyncGenerator(data)) {
        for (const frame of parser.nextChunk(chunk)) {
          yield frame;
        }
      }
      parser.finish();
    })(),
  );
  const header = (await blocks.next()).value;
  if (header == null || !("required_features" in header)) {
    throw Error("OSM PBF header block not found");
  }
  return {
    header,
    blocks: blocks as AsyncGenerator<OsmPbfBlock>,
  };
}

/**
 * Web `TransformStream` that decodes raw PBF byte chunks into OSM header and data blocks.
 *
 * The first blob in an OSM PBF file is always the header block; subsequent blobs
 * contain primitive data (nodes, ways, relations). This stream handles the framing,
 * decompression, and protobuf decoding automatically.
 *
 * @example
 * ```ts
 * import { OsmPbfBytesToBlocksTransformStream } from "@osmix/pbf"
 *
 * const response = await fetch('/data/monaco.pbf')
 * const blocksStream = response.body!
 *   .pipeThrough(new OsmPbfBytesToBlocksTransformStream())
 *
 * const reader = blocksStream.getReader()
 * const { value: header } = await reader.read() // First read yields header
 * // Subsequent reads yield primitive blocks
 * ```
 */
export class OsmPbfBytesToBlocksTransformStream extends TransformStream<
  Uint8Array<ArrayBufferLike>,
  OsmPbfHeaderBlock | OsmPbfBlock
> {
  parser = createOsmPbfBlobFrameGenerator();
  header: OsmPbfHeaderBlock | null = null;
  constructor(
    decompress: (
      data: Uint8Array<ArrayBuffer>,
      maxBytes?: number,
    ) => Promise<Uint8Array<ArrayBuffer>> = webDecompress,
  ) {
    super({
      transform: async (bytesChunk, controller) => {
        for (const frame of this.parser.nextChunk(bytesChunk)) {
          const decompressed = await decompress(frame.data, MAX_BLOB_SIZE_BYTES);
          if (decompressed.byteLength > MAX_BLOB_SIZE_BYTES) {
            throw Error(`Decompressed blob exceeds ${MAX_BLOB_SIZE_BYTES} bytes`);
          }
          if (frame.rawSize !== undefined && decompressed.byteLength !== frame.rawSize) {
            throw Error(
              `Decompressed blob size ${decompressed.byteLength} does not match declared raw size ${frame.rawSize}`,
            );
          }
          const pbf = new PbfReader(decompressed);
          if (this.header == null) {
            this.header = readHeaderBlock(pbf);
            controller.enqueue(this.header);
          } else {
            controller.enqueue(readPrimitiveBlock(pbf));
          }
        }
      },
      flush: () => {
        this.parser.finish();
        if (this.header == null) throw Error("OSM PBF header block not found");
      },
    });
  }
}
