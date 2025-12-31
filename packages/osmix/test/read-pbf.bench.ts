import { beforeAll, describe } from "bun:test"
import { getFixtureFile } from "@osmix/shared/test/fixtures"

// @ts-expect-error - bench is available at runtime but not in types
const { bench } = globalThis as { bench: typeof import("bun:test").test }

import { fromPbf } from "../src/pbf"

const PBF = "monaco.pbf"

let buffer: Uint8Array<ArrayBufferLike>

beforeAll(async () => {
	buffer = await getFixtureFile(PBF)
})

describe("PBF parse concurrency benchmark", () => {
	const noopProgress = () => {}

	bench("fromPbf (parseConcurrency=1)", async () => {
		const data = buffer.slice(0)
		await fromPbf(
			data,
			{
				id: "bench-single",
				parseConcurrency: 1,
				// Keep benchmark focused on parsing + indexes (not spatial indexes).
				buildSpatialIndexes: [],
			},
			noopProgress,
		)
	})

	bench("fromPbf (parseConcurrency=2)", async () => {
		const data = buffer.slice(0)
		await fromPbf(
			data,
			{
				id: "bench-par-2",
				parseConcurrency: 2,
				buildSpatialIndexes: [],
			},
			noopProgress,
		)
	})

	bench("fromPbf (parseConcurrency=4)", async () => {
		const data = buffer.slice(0)
		await fromPbf(
			data,
			{
				id: "bench-par-4",
				parseConcurrency: 4,
				buildSpatialIndexes: [],
			},
			noopProgress,
		)
	})
})
