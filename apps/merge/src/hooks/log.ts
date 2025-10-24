import { useSyncExternalStore } from "react"
import { Log } from "../state/log"

export function useLog() {
	return useSyncExternalStore(Log.subscribe, Log.getSnapshot)
}
