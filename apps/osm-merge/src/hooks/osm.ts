import { addLogMessageAtom } from "@/state/log"
import { osmWorkerAtom } from "@/state/worker"
import * as Comlink from "comlink"
import { useAtomValue, useSetAtom } from "jotai"
import { Osm } from "osm.ts"
import { useEffect, useMemo, useState } from "react"
import useStartTask from "./log"
import { useFitBoundsOnChange } from "./map"

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

	return { osm, setOsm, isLoading }
}
