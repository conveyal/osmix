/**
 * Short utility for checking index access.
 */
export function assertValue<T>(
	value?: T,
	message?: string,
): asserts value is NonNullable<T> {
	if (value === undefined || value === null) {
		throw Error(message ?? "Value is undefined or null")
	}
}
