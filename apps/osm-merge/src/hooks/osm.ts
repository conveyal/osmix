import { addLogMessageAtom } from "@/state/log"
import { createOsmWorker } from "@/workers/osm"
import { atom, useAtom, useSetAtom } from "jotai"
import { Osm } from "osm.ts"
import { useEffect, useMemo, useRef, useState } from "react"
import * as Comlink from "comlink"
import { useFitBoundsOnChange } from "./map"
import useStartTask from "./log"

declare global {
	interface Window {
		osmWorker: Awaited<ReturnType<typeof createOsmWorker>>
	}
}

const osmWorkerAtom = atom<Awaited<ReturnType<typeof createOsmWorker>> | null>(
	null,
)

export function useOsmWorker() {
	const isCreatingRef = useRef(false)
	const [osmWorker, setOsmWorker] = useAtom(osmWorkerAtom)
	const logMessage = useSetAtom(addLogMessageAtom)

	useEffect(() => {
		if (isCreatingRef.current) return
		isCreatingRef.current = true
		createOsmWorker().then(async (newOsmWorker) => {
			window.osmWorker = newOsmWorker
			await newOsmWorker.subscribeToLog(Comlink.proxy(logMessage))
			// React treats the return value as a function and tries to call it, so it must be wrapped.
			setOsmWorker(() => newOsmWorker)
		})
	}, [logMessage, setOsmWorker])

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
		const endOsmInitTask = startTask(`Processing file ${file.name}...`)
		const stream = file.stream()
		setOsm(null)
		setIsLoading(true)
		osmWorker
			.initFromPbfData(id ?? file.name, Comlink.transfer(stream, [stream]))
			.then(async (osmBuffers) => {
				setOsm(Osm.from(osmBuffers))
				endOsmInitTask(`${file.name} fully loaded.`)
			})
			.catch((e) => {
				console.error(e)
				endOsmInitTask(`${file.name} failed to load.`, "error")
			})
			.finally(() => {
				setIsLoading(false)
			})
	}, [file, id, osmWorker, startTask])

	return [osm, isLoading] as const
}
