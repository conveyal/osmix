import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/shared/test/fixtures"
import { assert, beforeAll, describe, it } from "vitest"
import { Osm } from "../src/osm"
import { osmFromPbf } from "../src/pbf"

describe("read", () => {
	describe.each(Object.entries(PBFs))("%s", async (name, pbf) => {
		beforeAll(() => getFixtureFile(pbf.url))

		it("into OSM class", async () => {
			const fileStream = getFixtureFileReadStream(pbf.url)
			const osm = new Osm({ id: name })
			await osmFromPbf(osm, fileStream)
			assert.equal(osm.nodes.size, pbf.nodes)
			assert.equal(osm.stringTable.length, pbf.uniqueStrings)
			assert.deepEqual(osm.nodes.getByIndex(0), pbf.node0)
			assert.equal(osm.ways.size, pbf.ways)
		})
	})
})
