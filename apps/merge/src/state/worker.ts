import * as Osmix from "osmix"
import OsmWorkerUrl from "../workers/osm.worker.ts?worker&url"
import { Log } from "./log"

declare global {
	interface Window {
		osmWorker: Osmix.OsmixRemote
	}
}

export const osmWorker = await Osmix.createRemote({
	onProgress: (progress) => Log.addMessage(progress.msg),
	workerUrl: new URL(OsmWorkerUrl, import.meta.url),
})

window.osmWorker = osmWorker
