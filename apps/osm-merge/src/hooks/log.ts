import { addLogMessageAtom, startTaskLogAtom } from "@/state/log"
import { activeTasksAtom } from "@/state/status"
import { osmWorker } from "@/state/worker"
import * as Comlink from "comlink"
import { useAtomValue, useSetAtom } from "jotai"
import { useEffect, useRef } from "react"

export default function useStartTaskLog() {
	return useSetAtom(startTaskLogAtom)
}

export function useHasActiveTasks() {
	return useAtomValue(activeTasksAtom) > 0
}

export function useSubscribeOsmWorkerToLog() {
	const logMessage = useSetAtom(addLogMessageAtom)
	const isSubscribedRef = useRef(false)

	useEffect(() => {
		if (isSubscribedRef.current) return
		isSubscribedRef.current = true
		osmWorker.subscribeToLog(Comlink.proxy(logMessage))
	}, [logMessage])

	return osmWorker
}
