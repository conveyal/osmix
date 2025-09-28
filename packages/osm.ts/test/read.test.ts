import assert from "node:assert"
import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/test-utils/fixtures"
import { beforeAll, describe, it } from "vitest"
import { createOsmIndexFromPbfData } from "../src/osm-from-pbf"

describe("read", () => {
	describe.each(Object.entries(PBFs))("%s", async (name, pbf) => {
		beforeAll(() => getFixtureFile(pbf.url))

		it("into OSM class", async () => {
			const fileStream = getFixtureFileReadStream(pbf.url)
			const osm = await createOsmIndexFromPbfData(fileStream, name)
			assert.equal(osm.nodes.size, pbf.nodes)
			assert.equal(osm.stringTable.length, pbf.uniqueStrings)
			assert.deepEqual(osm.nodes.getByIndex(0), pbf.node0)
			assert.equal(osm.ways.size, pbf.ways)
		})
	})
})
