import { wrap } from "comlink"
import type { OsmWorker } from "./osm.worker"

export async function createOsmWorker() {
	const worker = new Worker(new URL("./osm.worker.ts", import.meta.url), {
		type: "module",
	})
	const remote = wrap<OsmWorker>(worker)
	return remote
}
