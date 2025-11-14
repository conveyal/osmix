import { getFixtureFile } from "@osmix/shared/test/fixtures"
import type { GeoBbox2D } from "@osmix/shared/types"
import { beforeAll, bench, describe } from "vitest"
import { createExtract, createOsmFromPbf } from "../src"

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
		const full = await createOsmFromPbf(data)
		createExtract(full, BBOX, "simple")
	})

	bench("streaming extract during parse", async () => {
		const data = buffer.slice(0)
		await createOsmFromPbf(data, { extractBbox: BBOX })
	})
})
