import { concatBytes } from "./concat-bytes"

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

		chunks.push(value)
	}

	return concatBytes(chunks)
}
