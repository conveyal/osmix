import { beforeAll, describe, expect, it } from "bun:test"
import {
	getFixtureFile,
	getFixtureFileReadStream,
	PBFs,
} from "@osmix/shared/test/fixtures"
import { fromPbf } from "../src/pbf"

describe("read", () => {
	describe.each(Object.entries(PBFs))("%s", async (_name, pbf) => {
		beforeAll(() => getFixtureFile(pbf.url))

		it("into OSM class", async () => {
			const fileStream = getFixtureFileReadStream(pbf.url)
			const osm = await fromPbf(fileStream)
			expect(osm.nodes.size).toBe(pbf.nodes)
			expect(osm.stringTable.length).toBe(pbf.uniqueStrings)
			expect(osm.nodes.getByIndex(0)).toEqual(pbf.node0)
			expect(osm.ways.size).toBe(pbf.ways)
		})
	})
})
