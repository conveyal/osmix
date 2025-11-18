/**
 * Shared Progress Type. Planned expansion to handle percentage complete.
 */
export type Progress = {
	msg: string
}

export interface ProgressEvent extends CustomEvent<Progress> {}

export function progress(msg: string): Progress {
	return { msg }
}

export function progressEvent(msg: string): ProgressEvent {
	return new CustomEvent("progress", { detail: progress(msg) })
}

export function progressEventMessage(event: Event): string {
	return (event as ProgressEvent).detail.msg
}

export function logProgress(progress: ProgressEvent) {
	console.log(progressEventMessage(progress))
}
