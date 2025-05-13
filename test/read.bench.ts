import { bench } from "vitest"
import { PBFs } from "./files"
import { getFile, getFileStream } from "./utils"

import { createOsmPbfStream } from "../lib/create-osm-pbf-stream"
import { readOsmPbfPrimitiveBlocks } from "../lib/read-osm-pbf-blocks"

await Promise.all(Object.values(PBFs).map((p) => getFile(p.url)))

for (const [name, pbf] of Object.entries(PBFs)) {
	bench(`parse ${name}`, async () => {
		const stream = await getFileStream(pbf.url)
		const { blocks } = await createOsmPbfStream(stream)

		let count = 0
		for await (const block of readOsmPbfPrimitiveBlocks(blocks)) {
			count++
		}
	})
}
