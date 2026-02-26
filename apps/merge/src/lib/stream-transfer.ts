export function isStreamCloneable(stream: WritableStream<Uint8Array>): boolean {
	const { port1, port2 } = new MessageChannel()
	try {
		port1.postMessage(stream)
		return true
	} catch {
		return false
	} finally {
		port1.close()
		port2.close()
	}
}
