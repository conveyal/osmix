import type { GeoBbox2D } from "@osmix/shared/types"
import { getFixtureFile } from "@osmix/test-utils/fixtures"
import { beforeAll, bench, describe } from "vitest"
import { Osmix } from "../src/osmix"

const MONACO_BBOX: GeoBbox2D = [7.4053929, 43.7232244, 7.4447259, 43.7543687]
// const SEATTLE_BBOX: GeoBbox2D = [-122.33, 47.48, -122.29, 47.52]

const BBOX = MONACO_BBOX
const PBF = "monaco.pbf"

let buffer: ArrayBufferLike

beforeAll(async () => {
	buffer = await getFixtureFile(PBF)
})

describe("simple extract benchmark", () => {
	bench("two-step parse then extract", async () => {
		const data = buffer.slice(0)
		const full = await Osmix.fromPbf(data)
		full.extract(BBOX)
	})

	bench("streaming extract during parse", async () => {
		const data = buffer.slice(0)
		await Osmix.fromPbf(data, { extractBbox: BBOX })
	})
})
