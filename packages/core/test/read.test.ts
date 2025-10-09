import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/test-utils/fixtures"
import { assert, beforeAll, describe, it } from "vitest"
import { Osmix } from "../src/osmix"

describe("read", () => {
	describe.each(Object.entries(PBFs))("%s", async (name, pbf) => {
		beforeAll(() => getFixtureFile(pbf.url))

		it("into OSM class", async () => {
			const fileStream = getFixtureFileReadStream(pbf.url)
			const osm = new Osmix(name)
			await osm.readPbf(fileStream)
			assert.equal(osm.nodes.size, pbf.nodes)
			assert.equal(osm.stringTable.length, pbf.uniqueStrings)
			assert.deepEqual(osm.nodes.getByIndex(0), pbf.node0)
			assert.equal(osm.ways.size, pbf.ways)
		})
	})
})
