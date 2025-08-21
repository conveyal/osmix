import { createOsmWorker } from "@/workers/osm"
import { atom } from "jotai"

declare global {
	interface Window {
		osmWorker: Awaited<ReturnType<typeof createOsmWorker>>
	}
}

export const osmWorkerAtom = atom<Awaited<
	ReturnType<typeof createOsmWorker>
> | null>(null)

osmWorkerAtom.onMount = (setAtom) => {
	let unmounted = false
	createOsmWorker().then(async (newOsmWorker) => {
		if (unmounted) return
		window.osmWorker = newOsmWorker
		// React treats the return value as a function and tries to call it, so it must be wrapped.
		setAtom(() => newOsmWorker)
	})
	return () => {
		unmounted = true
	}
}
