import { describe, expect, it } from "bun:test"
import {
	CsvParseStream,
	type CsvParseStreamOptions,
} from "../src/csv-parse-stream"

async function parseCsv(
	chunks: string[],
	opts: CsvParseStreamOptions = {},
): Promise<Record<string, string>[]> {
	const source = new ReadableStream<string>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk)
			controller.close()
		},
	})

	const parsed = source.pipeThrough(new CsvParseStream(opts))
	return Array.fromAsync(parsed)
}

describe("CsvParseStream", () => {
	it("parses basic header + rows", async () => {
		const rows = await parseCsv(["id,name\n1,Alice\n2,Bob\n"])
		expect(rows).toEqual([
			{ id: "1", name: "Alice" },
			{ id: "2", name: "Bob" },
		])
	})

	it("handles quoted fields with commas and escaped quotes", async () => {
		const rows = await parseCsv([
			'id,name,notes\n1,"Alice, A.","says ""hi"""\n',
		])

		expect(rows).toEqual([{ id: "1", name: "Alice, A.", notes: 'says "hi"' }])
	})

	it("handles fields split across chunks", async () => {
		const rows = await parseCsv([
			"id,name,notes\n1,Alice,",
			'"line one',
			' and two"\n2,Bob,ok\n',
		])

		expect(rows).toEqual([
			{ id: "1", name: "Alice", notes: "line one and two" },
			{ id: "2", name: "Bob", notes: "ok" },
		])
	})

	it("supports comment skipping + header/value mapping", async () => {
		const rows = await parseCsv(
			["# comment\n", "id,name\n", "1,Alice\n", "2,Bob\n"],
			{
				skipComments: true,
				mapHeaders: ({ header }) => header.toUpperCase(),
				mapValues: ({ value }) => value.trim(),
			},
		)

		expect(rows).toEqual([
			{ ID: "1", NAME: "Alice" },
			{ ID: "2", NAME: "Bob" },
		])
	})
})
