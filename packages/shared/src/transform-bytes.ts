/**
 * Transform stream utilities.
 *
 * Helpers for piping byte arrays through TransformStreams (e.g., compression).
 *
 * @module
 */

import { bytesToStream } from "./bytes-to-stream"
import { streamToBytes } from "./stream-to-bytes"

/**
 * Pipe a byte array through a TransformStream and return the result.
 *
 * Useful for applying compression/decompression or other transformations
 * to byte data using the Web Streams API.
 *
 * @param bytes - The input bytes.
 * @param transformStream - The transform to apply (e.g., CompressionStream).
 * @returns A Promise resolving to the transformed bytes.
 *
 * @example
 * ```ts
 * const compressed = await transformBytes(data, new CompressionStream('gzip'))
 * ```
 */
export async function transformBytes(
	bytes: Uint8Array<ArrayBuffer>,
	transformStream: TransformStream<
		Uint8Array<ArrayBuffer>,
		Uint8Array<ArrayBuffer>
	>,
): Promise<Uint8Array<ArrayBuffer>> {
	return streamToBytes(bytesToStream(bytes).pipeThrough(transformStream))
}
