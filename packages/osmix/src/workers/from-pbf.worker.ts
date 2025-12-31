import type { Osm } from "@osmix/core"
import type { Progress, ProgressEvent } from "@osmix/shared/progress"
import { startCreateOsmFromPbf, type OsmFromPbfOptions } from "../pbf"

type FromPbfWorkerRequest = {
	data: Uint8Array<ArrayBufferLike>
	options?: Partial<OsmFromPbfOptions>
}

type FromPbfWorkerResponse =
	| { type: "progress"; value: Progress }
	| { type: "result"; value: ReturnType<Osm["transferables"]> }
	| { type: "error"; value: { message: string; stack?: string } }

addEventListener("message", async (e: MessageEvent<FromPbfWorkerRequest>) => {
	const { data, options } = e.data
	try {
		// Prevent recursion: ingestion is already happening in this worker.
		const safeOptions = { ...options, ingestInWorker: false }
		const gen = startCreateOsmFromPbf(data, safeOptions)
		while (true) {
			const { value, done } = await gen.next()
			if (done) {
				const osm = value
				const msg: FromPbfWorkerResponse = {
					type: "result",
					value: osm.transferables(),
				}
				postMessage(msg)
				break
			}
			const msg: FromPbfWorkerResponse = {
				type: "progress",
				value: (value as ProgressEvent).detail,
			}
			postMessage(msg)
		}
	} catch (err) {
		const msg: FromPbfWorkerResponse = {
			type: "error",
			value: {
				message: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined,
			},
		}
		postMessage(msg)
	}
})
