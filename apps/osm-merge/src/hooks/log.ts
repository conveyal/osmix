import { addLogMessageAtom, type Status, type StatusType } from "@/state/log"
import { activeTasksAtom } from "@/state/status"
import { useAtomValue, useSetAtom } from "jotai"
import { useCallback } from "react"

export default function useStartTask() {
	const setTasks = useSetAtom(activeTasksAtom)
	const logMessage = useSetAtom(addLogMessageAtom)

	const startTask = useCallback(
		function startTaskMessage(message: string, type: Status["type"] = "info") {
			setTasks((t) => t + 1)
			logMessage(message, type)
			return function endTaskMessage(
				message: string,
				type: Status["type"] = "info",
			) {
				setTasks((t) => t - 1)
				logMessage(message, type)
			}
		},
		[setTasks, logMessage],
	)

	return startTask
}

export function useStartTimer() {
	const logMessage = useSetAtom(addLogMessageAtom)
	return useCallback(
		function startTimer(message: string, type: StatusType = "debug") {
			const start = performance.now()
			logMessage(message, type)
			return function endTimer(message: string, type: StatusType = "debug") {
				const duration = performance.now() - start
				logMessage(`[${(duration / 1_000).toFixed(3)}s] ${message}`, type)
			}
		},
		[logMessage],
	)
}

export function useHasActiveTasks() {
	const tasks = useAtomValue(activeTasksAtom)
	return tasks > 0
}
