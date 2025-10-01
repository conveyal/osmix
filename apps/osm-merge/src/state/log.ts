export type StatusType = "info" | "debug" | "ready" | "error"

export type Status = {
	type: StatusType
	message: string
	duration: number
	timestamp: number
}

const INITIAL_STATUS: Status = {
	type: "info",
	message: "Application ready",
	duration: 0,
	timestamp: Date.now(),
}

function createLog() {
	const listeners = new Set<() => void>()
	let log: Status[] = [INITIAL_STATUS]
	let activeTasks = 0
	let state = { activeTasks, log }

	const emitChange = () => {
		state = { activeTasks, log }
		for (const listener of listeners) {
			listener()
		}
	}
	const subscribe = (fn: () => void) => {
		listeners.add(fn)
		return function unsubscribe() {
			listeners.delete(fn)
		}
	}
	const getSnapshot = () => state
	const addMessage = (
		message: string,
		type: Status["type"] = "info",
		durationMs?: number,
	) => {
		const msSinceLastLog = Date.now() - log[log.length - 1].timestamp
		if (type === "error") {
			console.error(message)
		} else {
			console.log(`${type}:`, message)
		}
		log = [
			...log,
			{
				type,
				message,
				duration: durationMs ?? msSinceLastLog,
				timestamp: Date.now(),
			},
		]
		emitChange()
	}
	const startTask = (message: string, type: Status["type"] = "info") => {
		activeTasks++
		const starTime = performance.now()
		addMessage(message, type)
		return {
			update: (message: string, type: Status["type"] = "info") => {
				addMessage(message, type)
			},
			end: (message: string, type: Status["type"] = "info") => {
				activeTasks--
				const durationMs = performance.now() - starTime
				addMessage(message, type, durationMs)
			},
		}
	}

	return {
		emitChange,
		subscribe,
		getSnapshot,
		addMessage,
		startTask,
	}
}

export const Log = createLog()
