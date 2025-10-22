import { bytesToStream } from "./bytes-to-stream"
import { streamToBytes } from "./stream-to-bytes"

export async function transformBytes(
	bytes: Uint8Array,
	transformStream: TransformStream<Uint8Array, Uint8Array>,
): Promise<Uint8Array> {
	return streamToBytes(bytesToStream(bytes).pipeThrough(transformStream))
}
