import { describe, expect, it } from "bun:test"
import { Ids } from "../src/ids"

describe("Ids", () => {
	it("adds IDs and returns their index", () => {
		const ids = new Ids()
		expect(ids.add(100)).toBe(0)
		expect(ids.add(200)).toBe(1)
		expect(ids.add(300)).toBe(2)
		expect(ids.size).toBe(3)
	})

	it("retrieves IDs by index after building", () => {
		const ids = new Ids()
		ids.add(100)
		ids.add(200)
		ids.add(300)
		ids.buildIndex()

		expect(ids.at(0)).toBe(100)
		expect(ids.at(1)).toBe(200)
		expect(ids.at(2)).toBe(300)
	})

	it("looks up index from ID after building", () => {
		const ids = new Ids()
		ids.add(100)
		ids.add(200)
		ids.add(300)
		ids.buildIndex()

		expect(ids.getIndexFromId(100)).toBe(0)
		expect(ids.getIndexFromId(200)).toBe(1)
		expect(ids.getIndexFromId(300)).toBe(2)
		expect(ids.getIndexFromId(999)).toBe(-1) // not found
	})

	it("checks if ID exists", () => {
		const ids = new Ids()
		ids.add(100)
		ids.add(200)
		ids.buildIndex()

		expect(ids.has(100)).toBe(true)
		expect(ids.has(200)).toBe(true)
		expect(ids.has(300)).toBe(false)
	})

	it("handles unsorted IDs", () => {
		const ids = new Ids()
		ids.add(300)
		ids.add(100)
		ids.add(200)
		ids.buildIndex()

		expect(ids.isSorted()).toBe(false)
		expect(ids.getIndexFromId(300)).toBe(0)
		expect(ids.getIndexFromId(100)).toBe(1)
		expect(ids.getIndexFromId(200)).toBe(2)
	})

	it("handles sorted IDs efficiently", () => {
		const ids = new Ids()
		ids.add(100)
		ids.add(200)
		ids.add(300)
		ids.buildIndex()

		expect(ids.isSorted()).toBe(true)
		expect(ids.getIndexFromId(100)).toBe(0)
		expect(ids.getIndexFromId(200)).toBe(1)
		expect(ids.getIndexFromId(300)).toBe(2)
	})

	it("provides sorted view of IDs", () => {
		const ids = new Ids()
		ids.add(300)
		ids.add(100)
		ids.add(200)
		ids.buildIndex()

		const sorted = Array.from(ids.sorted)
		expect(sorted).toEqual([100, 200, 300])
	})

	it("idOrIndex resolves both id and index", () => {
		const ids = new Ids()
		ids.add(100)
		ids.add(200)
		ids.buildIndex()

		const [idx1, id1] = ids.idOrIndex({ id: 100 })
		expect(idx1).toBe(0)
		expect(id1).toBe(100)

		const [idx2, id2] = ids.idOrIndex({ index: 1 })
		expect(idx2).toBe(1)
		expect(id2).toBe(200)
	})
})
