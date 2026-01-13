/**
 * Progress event helpers for long-running operations.
 *
 * Provides a standard interface for reporting progress from workers and
 * async operations. Uses CustomEvent for cross-context communication.
 *
 * @module
 */

export type ProgressLevel = "info" | "warn" | "error"

/**
 * Progress payload containing a message and timestamp.
 * Planned expansion to include percentage completion.
 */
export type Progress = {
	msg: string
	timestamp: number
	level: ProgressLevel
}

/** CustomEvent carrying progress details. */
export interface ProgressEvent extends CustomEvent<Progress> {}

/**
 * Create a Progress payload with current timestamp.
 * @param msg - The progress message.
 */
export function progress(msg: string, level: ProgressLevel = "info"): Progress {
	return {
		msg,
		timestamp: Date.now(),
		level,
	}
}

/**
 * Create a ProgressEvent with the given message.
 * @param msg - The progress message.
 */
export function progressEvent(
	msg: string,
	level: ProgressLevel = "info",
): ProgressEvent {
	return new CustomEvent("progress", { detail: progress(msg, level) })
}

/**
 * Extract the message string from a progress event.
 * @param event - The event to extract from.
 */
export function progressEventMessage(event: Event): string {
	return (event as ProgressEvent).detail.msg
}

/**
 * Log a progress event's message to the console.
 * @param progress - The progress event to log.
 */
export function logProgress(progress: ProgressEvent) {
	const level = progress.detail.level
	const message = progressEventMessage(progress)
	switch (level) {
		case "info":
			console.log(message)
			break
		case "warn":
			console.warn(message)
			break
		case "error":
			console.error(message)
			break
	}
}
