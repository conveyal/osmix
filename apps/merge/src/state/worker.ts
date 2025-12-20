import { createMergeRemote, type MergeRemote } from "../lib/merge-remote"
import { Log } from "./log"

declare global {
	interface Window {
		osmWorker: MergeRemote
	}
}

export const osmWorker = await createMergeRemote({
	onProgress: (progress) => Log.addMessage(progress.msg),
})

window.osmWorker = osmWorker
