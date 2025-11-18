import { describe, expect, it } from "bun:test"
import { wayIsArea } from "../src/way-is-area"

describe("wayIsArea", () => {
	it("returns false for open ways", () => {
		const refs = [1, 2, 3]
		expect(wayIsArea({ id: 0, refs, tags: { building: "yes" } })).toBe(false)
	})

	it("returns true for closed way without tags", () => {
		const refs = [1, 2, 3, 1]
		expect(wayIsArea({ id: 0, refs })).toBe(true)
	})

	it("honors explicit area override", () => {
		const refs = [1, 2, 3, 1]
		expect(
			wayIsArea({ id: 0, refs, tags: { area: "no", building: "yes" } }),
		).toBe(false)
		expect(wayIsArea({ id: 0, refs, tags: { area: "yes" } })).toBe(true)
	})

	it("treats implied tags as areas", () => {
		const refs = [1, 2, 3, 1]
		expect(wayIsArea({ id: 0, refs, tags: { building: "yes" } })).toBe(true)
	})

	it("considers included values", () => {
		const refs = [1, 2, 3, 1]
		expect(wayIsArea({ id: 0, refs, tags: { highway: "rest_area" } })).toBe(
			true,
		)
		expect(wayIsArea({ id: 0, refs, tags: { highway: "primary" } })).toBe(false)
	})

	it("rejects excluded values", () => {
		const refs = [1, 2, 3, 1]
		expect(wayIsArea({ id: 0, refs, tags: { natural: "coastline" } })).toBe(
			false,
		)
	})
})
