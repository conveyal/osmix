import { type Status, addLogMessageAtom } from "@/state/log"
import { activeTasksAtom } from "@/state/status"
import { useAtomValue, useSetAtom } from "jotai"
import { useCallback } from "react"

export default function useStartTaskLog() {
	const setTasks = useSetAtom(activeTasksAtom)
	const logMessage = useSetAtom(addLogMessageAtom)

	const startTask = useCallback(
		function startTaskMessage(message: string, type: Status["type"] = "info") {
			const starTime = performance.now()
			setTasks((t) => t + 1)
			logMessage(message, type)
			return {
				update: (message: string, type: Status["type"] = "info") => {
					logMessage(message, type)
				},
				end: (message: string, type: Status["type"] = "info") => {
					const durationMs = performance.now() - starTime
					setTasks((t) => t - 1)
					logMessage(message, type, durationMs)
				},
			}
		},
		[setTasks, logMessage],
	)

	return startTask
}

export function useHasActiveTasks() {
	const tasks = useAtomValue(activeTasksAtom)
	return tasks > 0
}
