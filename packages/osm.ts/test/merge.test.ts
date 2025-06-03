import { assert, describe, it } from "vitest"

import { Osm, createOsmPbfReader } from "../src"
import { getConflictingIds, merge } from "../src/merge"
import { getFile } from "./utils"

describe("merge osm", () => {
	it(
		"should merge two osm objects",
		{
			timeout: 100_000,
		},
		async () => {
			const osm1Name = "yakima-full.osm.pbf"
			const osm2Name = "yakima.osw.pbf"
			const osmMergedName = "yakima-merged.osm.pbf"

			const osm1Data = await getFile(osm1Name)
			const osm1Reader = await createOsmPbfReader(osm1Data)
			const osm1 = await Osm.fromPbfReader(osm1Reader)

			const osm2Data = await getFile(osm2Name)
			const osm2Reader = await createOsmPbfReader(osm2Data)
			const osm2 = await Osm.fromPbfReader(osm2Reader)

			const conflictingIds = getConflictingIds(osm1, osm2)
			assert.equal(conflictingIds.nodes.size, 0)
			assert.equal(conflictingIds.ways.size, 0)
			assert.equal(conflictingIds.relations.size, 0)

			const osmMerged = merge(osm1, osm2)
		},
	)
})
