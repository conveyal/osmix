import { bench } from "vitest"
import { PBFs } from "./files"
import { getFile, getFileStream } from "./utils"

import { createOsmPbfReadStream } from "../src/create-osm-pbf-read-stream"
import { readOsmPbfPrimitiveBlocks } from "../src/read-osm-pbf-blocks"

await Promise.all(Object.values(PBFs).map((p) => getFile(p.url)))

for (const [name, pbf] of Object.entries(PBFs)) {
	bench(`parse ${name}`, async () => {
		const stream = await getFileStream(pbf.url)
		const { blocks } = await createOsmPbfReadStream(stream)

		let count = 0
		for await (const block of readOsmPbfPrimitiveBlocks(blocks)) {
			count++
		}
	})
}
