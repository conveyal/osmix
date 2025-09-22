import { createOsmWorker } from "@/workers/osm"

declare global {
	interface Window {
		osmWorker: ReturnType<typeof createOsmWorker>
	}
}

export const osmWorker = createOsmWorker()

window.osmWorker = osmWorker
