/**
 * Throttling utilities for rate-limiting function calls.
 *
 * Useful for limiting progress updates from workers or other high-frequency
 * operations to avoid overwhelming the UI or logging.
 *
 * @module
 */

/**
 * Create a throttled version of a function that only executes at most
 * once per `timeFrame` milliseconds.
 *
 * @param func - The function to throttle.
 * @param timeFrame - Minimum time between calls in milliseconds.
 * @returns A throttled version of the function.
 *
 * @example
 * ```ts
 * const logThrottled = throttle((msg) => console.log(msg), 1000)
 * // Only logs at most once per second
 * for (let i = 0; i < 1000; i++) logThrottled(`Progress: ${i}`)
 * ```
 */
export function throttle<T extends unknown[]>(
	func: (...args: T) => void,
	timeFrame: number,
) {
	let lastTime = 0
	return (...args: T) => {
		const now = Date.now()
		if (now - lastTime >= timeFrame) {
			func(...args)
			lastTime = now
		}
	}
}
