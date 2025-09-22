import { startTaskLogAtom } from "@/state/log"
import { activeTasksAtom } from "@/state/status"
import { useAtomValue, useSetAtom } from "jotai"

export default function useStartTaskLog() {
	return useSetAtom(startTaskLogAtom)
}

export function useHasActiveTasks() {
	return useAtomValue(activeTasksAtom) > 0
}
