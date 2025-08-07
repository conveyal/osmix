import { wrap, proxy } from "comlink"
import type { OsmWorker } from "./osm.worker"

export async function createOsmWorker() {
	const worker = new Worker(new URL("./osm.worker.ts", import.meta.url), {
		type: "module",
	})
	const remote = wrap<OsmWorker>(worker)

	await remote.subscribeToPerformanceObserver(
		proxy((entryType, name, startTime, duration, detail, timeOrigin) => {
			// Align: worker-relative startTime -> main-relative startTime
			// aligned = e.startTime + (worker.timeOrigin - main.timeOrigin)
			const offset = timeOrigin - performance.timeOrigin
			const alignedStart = startTime + offset

			if (entryType === "mark") {
				performance.mark(name, {
					startTime: alignedStart,
					detail,
				})
			} else if (entryType === "measure") {
				performance.measure(name, {
					start: alignedStart,
					duration,
					detail,
				})
			}
		}),
	)

	return remote
}
