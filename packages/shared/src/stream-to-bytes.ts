/**
 * Stream to byte array conversion.
 *
 * Consumes a ReadableStream and concatenates all chunks into a single Uint8Array.
 *
 * @module
 */

import { concatBytes } from "./concat-bytes"

/**
 * Consume a ReadableStream and return all data as a single Uint8Array.
 *
 * Reads all chunks from the stream and concatenates them.
 * The stream will be fully consumed after this function returns.
 *
 * @param stream - The stream to consume.
 * @returns A Promise resolving to the concatenated bytes.
 */
export async function streamToBytes(
	stream: ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array<ArrayBuffer>> {
	const reader = stream.getReader()
	const chunks: Uint8Array<ArrayBuffer>[] = []

	while (true) {
		const { done, value } = await reader.read()

		if (done) {
			break
		}

		if (value !== undefined) chunks.push(value)
	}

	return concatBytes(chunks)
}
