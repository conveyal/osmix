import { wrap } from "comlink"
import type { OsmixWorker } from "./osm.worker"

export function createOsmWorker() {
	const worker = new Worker(new URL("./osm.worker.ts", import.meta.url), {
		type: "module",
	})
	return wrap<OsmixWorker>(worker)
}
