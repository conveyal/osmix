import { atom } from "jotai"

export const activeTasksAtom = atom(0)
export const actionPendingAtom = atom(false)

/**
 * Signal for cancelling an in-progress merge operation.
 * Set to an AbortController when a merge starts, null otherwise.
 */
export const mergeAbortControllerAtom = atom<AbortController | null>(null)

/**
 * Derived atom to check if a merge can be cancelled.
 */
export const canCancelMergeAtom = atom(
	(get) => get(mergeAbortControllerAtom) !== null,
)
