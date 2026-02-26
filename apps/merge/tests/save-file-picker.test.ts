import { afterEach, describe, expect, it } from "bun:test"
import { shouldRetrySavePickerWithPolyfill } from "../src/lib/save-file-picker"

const originalNavigator = globalThis.navigator

afterEach(() => {
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: originalNavigator,
	})
})

describe("shouldRetrySavePickerWithPolyfill", () => {
	it("retries in automated browser contexts", () => {
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: { webdriver: true },
		})

		expect(
			shouldRetrySavePickerWithPolyfill(
				new DOMException("The user aborted a request", "AbortError"),
			),
		).toBe(true)
	})

	it("does not retry on intentional picker cancel", () => {
		expect(
			shouldRetrySavePickerWithPolyfill(
				new DOMException("The user aborted a request", "AbortError"),
			),
		).toBe(false)
	})

	it("retries on security-style failures", () => {
		expect(
			shouldRetrySavePickerWithPolyfill(
				new DOMException("Blocked by browser policy", "SecurityError"),
			),
		).toBe(true)
	})

	it("retries on activation-related abort errors", () => {
		expect(
			shouldRetrySavePickerWithPolyfill(
				new DOMException("Must be handling a user gesture", "AbortError"),
			),
		).toBe(true)
	})
})
