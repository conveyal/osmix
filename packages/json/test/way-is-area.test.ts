import { describe, expect, it } from "vitest"
import { wayIsArea } from "../src/way-is-area"

describe("wayIsArea", () => {
	it("returns false for open ways", () => {
		const refs = [1, 2, 3]
		expect(wayIsArea(refs, { building: "yes" })).toBe(false)
	})

	it("returns true for closed way without tags", () => {
		const refs = [1, 2, 3, 1]
		expect(wayIsArea(refs)).toBe(true)
	})

	it("honors explicit area override", () => {
		const refs = [1, 2, 3, 1]
		expect(wayIsArea(refs, { area: "no", building: "yes" })).toBe(false)
		expect(wayIsArea(refs, { area: "yes" })).toBe(true)
	})

	it("treats implied tags as areas", () => {
		const refs = [1, 2, 3, 1]
		expect(wayIsArea(refs, { building: "yes" })).toBe(true)
	})

	it("considers included values", () => {
		const refs = [1, 2, 3, 1]
		expect(wayIsArea(refs, { highway: "rest_area" })).toBe(true)
		expect(wayIsArea(refs, { highway: "primary" })).toBe(false)
	})

	it("rejects excluded values", () => {
		const refs = [1, 2, 3, 1]
		expect(wayIsArea(refs, { natural: "coastline" })).toBe(false)
	})
})
