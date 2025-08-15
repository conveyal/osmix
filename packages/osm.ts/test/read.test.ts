import assert from "node:assert"
import { describe, it } from "vitest"

import { Osm } from "../src/osm"
import { PBFs } from "./files"
import { getFileReadStream } from "./utils"

describe("read", () => {
	describe.each(Object.entries(PBFs))(
		"%s",
		{ timeout: 300_000 },
		async (name, pbf) => {
			it.runIf(pbf.nodes <= 40_000)("into OSM class", async () => {
				const fileStream = await getFileReadStream(pbf.url)
				const osm = await Osm.fromPbfData(fileStream)
				assert.equal(osm.nodes.size, pbf.nodes)
				assert.equal(osm.stringTable.length, pbf.uniqueStrings)
				assert.deepEqual(osm.nodes.getByIndex(0), pbf.node0)
				assert.equal(osm.ways.size, pbf.ways)
			})
		},
	)
})
