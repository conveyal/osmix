import { beforeAll, describe, expect, it } from "vitest"
import monacoPbf from "../../../fixtures/monaco.pbf?url"

const getPbf = () => fetch(monacoPbf).then((res) => res.arrayBuffer())

describe("DuckDB", () => {
	const shouldSkip = "Bun" in globalThis || import.meta.env.CI === "true"
	if (shouldSkip) {
		it.skip("skips DuckDB tests in Bun or CI", () => {})
		return
	}

	let worker: {
		init: () => Promise<void>
		loadFromPbf: (pbf: ArrayBuffer, name: string) => Promise<void>
		isReady: () => boolean
	}

	beforeAll(async () => {
		const { DuckDBBenchWorker } = await import("../src/workers/duckdb.worker")
		worker = new DuckDBBenchWorker()
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
