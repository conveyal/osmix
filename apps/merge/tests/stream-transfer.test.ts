import { afterEach, describe, expect, it } from "bun:test"
import { isStreamCloneable } from "../src/lib/stream-transfer"

const OriginalMessageChannel = globalThis.MessageChannel

afterEach(() => {
	Object.defineProperty(globalThis, "MessageChannel", {
		configurable: true,
		value: OriginalMessageChannel,
	})
})

describe("isStreamCloneable", () => {
	it("returns true when posting stream succeeds", () => {
		class MockMessageChannel {
			port1 = {
				postMessage: () => {},
				close: () => {},
			}
			port2 = {
				close: () => {},
			}
		}

		Object.defineProperty(globalThis, "MessageChannel", {
			configurable: true,
			value: MockMessageChannel,
		})

		expect(isStreamCloneable(new WritableStream<Uint8Array>())).toBe(true)
	})

	it("returns false when posting stream throws", () => {
		class MockMessageChannel {
			port1 = {
				postMessage: () => {
					throw new DOMException("Could not clone", "DataCloneError")
				},
				close: () => {},
			}
			port2 = {
				close: () => {},
			}
		}

		Object.defineProperty(globalThis, "MessageChannel", {
			configurable: true,
			value: MockMessageChannel,
		})

		expect(isStreamCloneable(new WritableStream<Uint8Array>())).toBe(false)
	})
})
