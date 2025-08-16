import { addLogMessageAtom, type Status } from "@/state/log"
import { activeTasksAtom } from "@/state/status"
import { useAtom, useSetAtom } from "jotai"
import { useCallback } from "react"

export default function useTaskStatus() {
	const [tasks, setTasks] = useAtom(activeTasksAtom)
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

	return [tasks > 0, startTask] as const
}
