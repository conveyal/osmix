import { beforeAll, bench, describe } from "vitest"
import monacoPbf from "../../../fixtures/monaco.pbf?url"
import { DuckDBBenchWorker } from "../src/workers/duckdb.worker"
import { OsmixBenchWorker } from "../src/workers/osmix.worker"

const getPbf = () => fetch(monacoPbf).then((res) => res.arrayBuffer())

describe("Osmix vs DuckDB", () => {
	const osmix = new OsmixBenchWorker()
	const duckdb = new DuckDBBenchWorker()
	let pbf: ArrayBuffer

	beforeAll(async () => {
		await duckdb.init()
		pbf = await getPbf()
	})

	describe("load", () => {
		bench("osmix", async () => {
			await osmix.loadFromPbf(pbf.slice())
		})

		bench("duckdb", async () => {
			await duckdb.loadFromPbf(pbf.slice(), "monaco.pbf")
		})
	})
})
