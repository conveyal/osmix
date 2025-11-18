import { describe, expect, it } from "bun:test"
import { toAsyncGenerator } from "@osmix/pbf"
import { getFixtureFileReadStream, PBFs } from "@osmix/shared/test/fixtures"
import type { OsmEntity, OsmNode } from "@osmix/shared/types"
import { isNode, isWay } from "@osmix/shared/utils"
import { osmPbfToJson } from "../src/pbf-to-json"

describe("geojson", () => {
	describe.each(Object.entries(PBFs))("%s", async (_, pbf) => {
		it("generate from pbf", async () => {
			const file = getFixtureFileReadStream(pbf.url)
			const osmGenerator = toAsyncGenerator(osmPbfToJson(file))
			const header = (await osmGenerator.next()).value
			expect(header.bbox).toEqual(pbf.bbox)

			const entities: OsmEntity[] = []
			for await (const entity of osmGenerator) {
				if ("id" in entity) {
					entities.push(entity)
				}
			}

			// Check that all features are valid and have unique IDs
			const nodeMap = new Map<number, OsmNode>()
			let nodeFeatures = 0
			const seenWayIds = new Set()
			let wayFeatures = 0
			for (const entity of entities) {
				if (isNode(entity)) {
					const node = entity
					nodeMap.set(node.id, node)
					if (!node.tags || Object.keys(node.tags).length === 0) continue
					nodeFeatures++
				} else if (isWay(entity)) {
					const way = entity
					expect(seenWayIds.has(way.id)).toBe(false)
					seenWayIds.add(way.id)
					wayFeatures++
				}
			}

			expect(wayFeatures).toBe(pbf.ways)
			expect(nodeFeatures).toBe(pbf.nodesWithTags)
		})
	})
})
