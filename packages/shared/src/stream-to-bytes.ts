import { concatBytes } from "./concat-bytes"

export async function streamToBytes(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	const reader = stream.getReader()
	const chunks: Uint8Array[] = []

	while (true) {
		const { done, value } = await reader.read()

		if (done) {
			break
		}

		chunks.push(value)
	}

	return concatBytes(chunks)
}
