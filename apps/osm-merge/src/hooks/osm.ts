import { createOsmWorker } from "@/workers/osm"
import { useEffect, useRef, useState } from "react"

declare global {
	interface Window {
		osmWorker: Awaited<ReturnType<typeof createOsmWorker>>
	}
}

export function useOsmWorker() {
	const isCreatingRef = useRef(false)
	const [osmWorker, setOsmWorker] = useState<Awaited<
		ReturnType<typeof createOsmWorker>
	> | null>(null)

	useEffect(() => {
		if (isCreatingRef.current) return
		isCreatingRef.current = true
		createOsmWorker().then(async (newOsmWorker) => {
			window.osmWorker = newOsmWorker
			// React treats the return value as a function and tries to call it, so it must be wrapped.
			setOsmWorker(() => newOsmWorker)
		})
	}, [])

	return osmWorker
}
