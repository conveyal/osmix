import * as Osmix from "osmix"
import { beforeAll, bench, describe } from "vitest"
import monacoPbf from "../../../fixtures/monaco.pbf?url"
import { DuckDBBenchWorker } from "../src/workers/duckdb.worker"

const getPbf = () => fetch(monacoPbf).then((res) => res.arrayBuffer())

describe.runIf(import.meta.env.CI !== "true")("Osmix vs DuckDB", async () => {
	const osmixRemote = await Osmix.createRemote()
	const duckdb = new DuckDBBenchWorker()
	let pbf: ArrayBuffer

	beforeAll(async () => {
		await duckdb.init()
		pbf = await getPbf()
	})

	describe("load", () => {
		bench("osmix", async () => {
			await osmixRemote.fromPbf(pbf.slice())
		})

		bench("duckdb", async () => {
			await duckdb.loadFromPbf(pbf.slice(), "monaco.pbf")
		})
	})
})
