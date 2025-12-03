import { OsmixRemote } from "osmix"
import OsmWorkerUrl from "../workers/osm.worker.ts?worker&url"
import { Log } from "./log"

declare global {
	interface Window {
		osmWorker: OsmixRemote
	}
}

export const osmWorker = await OsmixRemote.connect({
	onProgress: (progress) => Log.addMessage(progress.msg),
	workerUrl: new URL(OsmWorkerUrl, import.meta.url),
})

window.osmWorker = osmWorker
