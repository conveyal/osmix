import { addLogMessageAtom, startTaskLogAtom } from "@/state/log"
import { activeTasksAtom } from "@/state/status"
import { osmWorker } from "@/state/worker"
import * as Comlink from "comlink"
import { useAtomValue, useSetAtom } from "jotai"
import { useEffect } from "react"

export default function useStartTaskLog() {
	return useSetAtom(startTaskLogAtom)
}

export function useHasActiveTasks() {
	return useAtomValue(activeTasksAtom) > 0
}
export function useSubscribeOsmWorkerToLog() {
	const logMessage = useSetAtom(addLogMessageAtom)

	useEffect(() => {
		if (osmWorker && logMessage) {
			console.log("SUBSCRIBING TO LOG")
			osmWorker.subscribeToLog(Comlink.proxy(logMessage))
			osmWorker.subscribeToPerformanceObserver(
				Comlink.proxy(
					(entryType, name, startTime, duration, detail, timeOrigin) => {
						// Align: worker-relative startTime -> main-relative startTime
						// aligned = e.startTime + (worker.timeOrigin - main.timeOrigin)
						const offset = timeOrigin - performance.timeOrigin
						const alignedStart = startTime + offset

						if (entryType === "mark") {
							performance.mark(name, {
								startTime: alignedStart,
								detail,
							})
						} else if (entryType === "measure") {
							performance.measure(name, {
								start: alignedStart,
								duration,
								detail,
							})
						}
					},
				),
			)
		}
	}, [logMessage])

	return osmWorker
}
