import { beforeAll, describe, expect, it } from "vitest"
import monacoPbf from "../../../fixtures/monaco.pbf?url"

const getPbf = () => fetch(monacoPbf).then((res) => res.arrayBuffer())

if ("Bun" in globalThis || import.meta.env.CI === "true") {
	console.log("Skipping DuckDB tests in Bun or CI")
} else {
	describe("DuckDB", async () => {
		const { DuckDBBenchWorker } = await import("../src/workers/duckdb.worker")
		const worker = new DuckDBBenchWorker()

		beforeAll(async () => {
			await worker.init()
			const pbf = await getPbf()
			await worker.loadFromPbf(pbf, "monaco.pbf")
		})

		describe("initialization", () => {
			it("should initialize successfully", () => {
				expect(worker.isReady()).toBe(true)
			})
		})
	})
}
