import { OsmixRemote } from "osmix"
import { Log } from "./log"

declare global {
	interface Window {
		osmWorker: OsmixRemote
	}
}

export const osmWorker = await OsmixRemote.connect({
	workerCount: navigator.hardwareConcurrency ?? 1,
	onProgress: (progress) => Log.addMessage(progress.msg),
})

window.osmWorker = osmWorker
