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

		it("into OSM class (ingest in worker)", async () => {
			const bytes = await getFixtureFile(pbf.url)
			const osm = await fromPbf(bytes, { ingestInWorker: true })
			expect(osm.nodes.size).toBe(pbf.nodes)
			expect(osm.stringTable.length).toBe(pbf.uniqueStrings)
			expect(osm.nodes.getByIndex(0)).toEqual(pbf.node0)
			expect(osm.ways.size).toBe(pbf.ways)
		})

		it("into OSM class (parallel decode)", async () => {
			const fileStream = getFixtureFileReadStream(pbf.url)
			const osm = await fromPbf(fileStream, { parseConcurrency: 2 })
			expect(osm.nodes.size).toBe(pbf.nodes)
			expect(osm.stringTable.length).toBe(pbf.uniqueStrings)
			expect(osm.nodes.getByIndex(0)).toEqual(pbf.node0)
			expect(osm.ways.size).toBe(pbf.ways)
		})

		it("parallel decode matches single-thread content", async () => {
			const fileStream1 = getFixtureFileReadStream(pbf.url)
			const fileStream2 = getFixtureFileReadStream(pbf.url)
			const [single, parallel] = await Promise.all([
				fromPbf(fileStream1, { parseConcurrency: 1 }),
				fromPbf(fileStream2, { parseConcurrency: 2 }),
			])
			expect(parallel.isEqual(single)).toBe(true)
		})
	})
})
