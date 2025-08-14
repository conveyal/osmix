import { bench } from "vitest"
import { PBFs } from "./files"
import { getFile, getFileReadStream } from "./utils"

import { OsmPbfReader } from "../src/pbf/osm-pbf-reader"

await Promise.all(Object.values(PBFs).map((p) => getFile(p.url)))

for (const [name, pbf] of Object.entries(PBFs)) {
	bench(`parse ${name}`, async () => {
		const stream = await getFileReadStream(pbf.url)
		const osm = await OsmPbfReader.from(stream)

		let count = 0
		for await (const block of osm.blocks) {
			for (const group of block.primitivegroup) {
				count += group.nodes.length
				count += group.dense != null ? group.dense.id.length : 0
				count += group.ways.length
				count += group.relations.length
			}
		}
	})
}
