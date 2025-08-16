import { atom } from "jotai"

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
	(get, set, message: string, type: Status["type"] = "info") => {
		const log = get(logAtom)
		const msSinceLastLog = Date.now() - log[log.length - 1].timestamp
		const durationSeconds = `${(msSinceLastLog / 1000).toFixed(2)}s`
		if (type === "error") {
			console.error(`${type} (${durationSeconds}):`, message)
		} else {
			console.log(`${type} (${durationSeconds}):`, message)
		}
		set(logAtom, [
			...log,
			{
				type,
				message,
				duration: msSinceLastLog,
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
