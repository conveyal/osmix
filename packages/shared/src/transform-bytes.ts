import { bytesToStream } from "./bytes-to-stream"
import { streamToBytes } from "./stream-to-bytes"

export async function transformBytes(
	bytes: Uint8Array<ArrayBuffer>,
	transformStream: TransformStream<
		Uint8Array<ArrayBuffer>,
		Uint8Array<ArrayBuffer>
	>,
): Promise<Uint8Array<ArrayBuffer>> {
	return streamToBytes(bytesToStream(bytes).pipeThrough(transformStream))
}
