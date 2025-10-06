import { proxy } from "comlink"
import { createOsmWorker } from "@/workers/osm"
import { Log } from "./log"

declare global {
	interface Window {
		osmWorker: ReturnType<typeof createOsmWorker>
	}
}

export const osmWorker = createOsmWorker()

osmWorker.setLogger(proxy(Log.addMessage))

window.osmWorker = osmWorker
