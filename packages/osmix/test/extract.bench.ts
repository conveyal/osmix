import { beforeAll, describe } from "bun:test"
import { getFixtureFile } from "@osmix/shared/test/fixtures"
import type { GeoBbox2D } from "@osmix/shared/types"

// @ts-expect-error - bench is available at runtime but not in types
const { bench } = globalThis as { bench: typeof import("bun:test").test }

import { createExtract } from "../src/extract"
import { fromPbf } from "../src/pbf"

const MONACO_BBOX: GeoBbox2D = [7.4053929, 43.7232244, 7.4447259, 43.7543687]
// const SEATTLE_BBOX: GeoBbox2D = [-122.33, 47.48, -122.29, 47.52]

const BBOX = MONACO_BBOX
const PBF = "monaco.pbf"

let buffer: Uint8Array<ArrayBufferLike>

beforeAll(async () => {
	buffer = await getFixtureFile(PBF)
})

describe("simple extract benchmark", () => {
	bench("two-step parse then extract", async () => {
		const data = buffer.slice(0)
		const full = await fromPbf(data)
		createExtract(full, BBOX, "simple")
	})

	bench("streaming extract during parse", async () => {
		const data = buffer.slice(0)
		await fromPbf(data, { extractBbox: BBOX })
	})
})
