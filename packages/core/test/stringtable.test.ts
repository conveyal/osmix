import { describe, expect, it } from "bun:test"
import StringTable from "../src/stringtable"

describe("StringTable", () => {
	it("adds strings and returns their index", () => {
		const st = new StringTable()
		expect(st.add("highway")).toBe(0)
		expect(st.add("primary")).toBe(1)
		expect(st.add("name")).toBe(2)
		expect(st.length).toBe(3)
	})

	it("deduplicates identical strings", () => {
		const st = new StringTable()
		expect(st.add("highway")).toBe(0)
		expect(st.add("primary")).toBe(1)
		expect(st.add("highway")).toBe(0) // same index
		expect(st.length).toBe(2)
	})

	it("retrieves strings by index", () => {
		const st = new StringTable()
		st.add("highway")
		st.add("primary")
		st.add("name")

		expect(st.get(0)).toBe("highway")
		expect(st.get(1)).toBe("primary")
		expect(st.get(2)).toBe("name")
	})

	it("finds string index by value", () => {
		const st = new StringTable()
		st.add("highway")
		st.add("primary")
		st.buildIndex()

		expect(st.find("highway")).toBe(0)
		expect(st.find("primary")).toBe(1)
		expect(st.find("unknown")).toBe(-1)
	})

	it("handles empty strings", () => {
		const st = new StringTable()
		expect(st.add("")).toBe(0)
		expect(st.get(0)).toBe("")
	})

	it("handles unicode strings", () => {
		const st = new StringTable()
		st.add("日本語")
		st.add("émoji 🎉")

		expect(st.get(0)).toBe("日本語")
		expect(st.get(1)).toBe("émoji 🎉")
	})

	it("creates and uses transferables", () => {
		const st = new StringTable()
		st.add("highway")
		st.add("primary")
		st.buildIndex()

		const transferables = st.transferables()
		const st2 = new StringTable(transferables)

		expect(st2.get(0)).toBe("highway")
		expect(st2.get(1)).toBe("primary")
	})
})
