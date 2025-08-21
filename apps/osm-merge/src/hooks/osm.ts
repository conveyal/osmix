import { addLogMessageAtom } from "@/state/log"
import { createOsmWorker } from "@/workers/osm"
import * as Comlink from "comlink"
import { atom, useAtomValue, useSetAtom } from "jotai"
import { Osm } from "osm.ts"
import { useEffect, useMemo, useState } from "react"
import useStartTask from "./log"
import { useFitBoundsOnChange } from "./map"

declare global {
	interface Window {
		osmWorker: Awaited<ReturnType<typeof createOsmWorker>>
	}
}

const osmWorkerAtom = atom<Awaited<ReturnType<typeof createOsmWorker>> | null>(
	null,
)

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

export function useOsmWorker() {
	const osmWorker = useAtomValue(osmWorkerAtom)
	const logMessage = useSetAtom(addLogMessageAtom)

	useEffect(() => {
		if (osmWorker && logMessage) {
			osmWorker.subscribeToLog(Comlink.proxy(logMessage))
		}
	}, [logMessage, osmWorker])

	return osmWorker
}

export function useOsmFile(file: File | null, id?: string) {
	const [osm, setOsm] = useState<Osm | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const osmWorker = useOsmWorker()
	const startTask = useStartTask()
	const bbox = useMemo(() => osm?.bbox(), [osm])

	useFitBoundsOnChange(bbox)

	useEffect(() => {
		if (!osmWorker || !file) return
		console.log("useOsmFile", file, id, osmWorker)
		const task = startTask(`Processing file ${file.name}...`)
		const stream = file.stream()
		setOsm(null)
		setIsLoading(true)
		osmWorker
			.initFromPbfData(id ?? file.name, Comlink.transfer(stream, [stream]))
			.then(async (osmBuffers) => {
				setOsm(Osm.from(osmBuffers))
				task.end(`${file.name} fully loaded.`)
			})
			.catch((e) => {
				console.error(e)
				task.end(`${file.name} failed to load.`, "error")
			})
			.finally(() => {
				setIsLoading(false)
			})
	}, [file, id, osmWorker, startTask])

	return [osm, setOsm, isLoading] as const
}
