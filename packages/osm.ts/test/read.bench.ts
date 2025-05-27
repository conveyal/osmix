import { bench } from "vitest"
import { PBFs } from "./files"
import { getFile, getFileReadStream } from "./utils"

import { createOsmPbfReader } from "../src/osm-pbf-reader"

await Promise.all(Object.values(PBFs).map((p) => getFile(p.url)))

for (const [name, pbf] of Object.entries(PBFs)) {
	bench(`parse ${name}`, async () => {
		const stream = await getFileReadStream(pbf.url)
		const osm = await createOsmPbfReader(stream)

		let count = 0
		for await (const entity of osm.generateEntities()) {
			count++
		}
	})
}
