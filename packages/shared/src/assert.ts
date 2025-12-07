/**
 * Assertion utilities for defensive programming.
 *
 * Provides typed assertion helpers that throw errors when conditions are not met,
 * commonly used for index bounds checking and null/undefined guards.
 *
 * @module
 */

/**
 * Assert that a value is neither null nor undefined.
 *
 * @param value - The value to check.
 * @param message - Optional error message if assertion fails.
 * @throws Error if value is null or undefined.
 *
 * @example
 * ```ts
 * const item = array[index]
 * assertValue(item, `No item at index ${index}`)
 * // TypeScript now knows item is non-nullable
 * ```
 */
export function assertValue<T>(
	value?: T,
	message?: string,
): asserts value is NonNullable<T> {
	if (value === undefined || value === null) {
		throw Error(message ?? "Value is undefined or null")
	}
}
