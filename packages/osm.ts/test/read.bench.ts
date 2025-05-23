import { bench } from "vitest"
import { PBFs } from "./files"
import { getFile, getFileReadStream } from "./utils"

import { pbfToBlocks } from "../src/pbf-to-blocks"
import { readOsmPbfPrimitiveBlocks } from "../src/read-osm-pbf"

await Promise.all(Object.values(PBFs).map((p) => getFile(p.url)))

for (const [name, pbf] of Object.entries(PBFs)) {
	bench(`parse ${name}`, async () => {
		const stream = await getFileReadStream(pbf.url)
		const { blocks } = await pbfToBlocks(stream)

		let count = 0
		for await (const block of readOsmPbfPrimitiveBlocks(blocks)) {
			count++
		}
	})
}
