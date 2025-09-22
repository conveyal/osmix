import { atom } from "jotai"
import { activeTasksAtom } from "./status"

export type StatusType = "info" | "debug" | "ready" | "error"

export type Status = {
	type: StatusType
	message: string
	duration: number
	timestamp: number
}

const INITIAL_STATUS: Status = {
	type: "info",
	message: "Initializing application...",
	duration: 0,
	timestamp: Date.now(),
}

export const logAtom = atom<Status[]>([INITIAL_STATUS])

export const addLogMessageAtom = atom(
	null,
	(
		get,
		set,
		message: string,
		type: Status["type"] = "info",
		durationMs?: number,
	) => {
		const log = get(logAtom)
		const msSinceLastLog = Date.now() - log[log.length - 1].timestamp
		if (type === "error") {
			console.error(message)
		} else {
			console.log(`${type}:`, message)
		}
		set(logAtom, [
			...log,
			{
				type,
				message,
				duration: durationMs ?? msSinceLastLog,
				timestamp: Date.now(),
			},
		])
	},
)

export const currentStatusAtom = atom((get) => {
	const log = get(logAtom)
	// don't show the debug logs in the status bar
	return log.findLast((l) => l.type !== "debug") ?? INITIAL_STATUS
})

export const startTaskLogAtom = atom(
	null,
	(_, set, message: string, type: Status["type"] = "info") => {
		const starTime = performance.now()
		set(activeTasksAtom, (t) => t + 1)
		set(addLogMessageAtom, message, type)
		return {
			update: (message: string, type: Status["type"] = "info") => {
				set(addLogMessageAtom, message, type)
			},
			end: (message: string, type: Status["type"] = "info") => {
				const durationMs = performance.now() - starTime
				set(activeTasksAtom, (t) => t - 1)
				set(addLogMessageAtom, message, type, durationMs)
			},
		}
	},
)
