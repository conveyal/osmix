import { beforeAll, describe, expect, it } from "vitest"
import monacoPbf from "../../../fixtures/monaco.pbf?url"
import { DuckDBBenchWorker } from "../src/workers/duckdb.worker"

const getPbf = () => fetch(monacoPbf).then((res) => res.arrayBuffer())

describe.runIf(import.meta.env.CI !== "true")("DuckDB", () => {
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
