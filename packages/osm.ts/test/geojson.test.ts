import assert from "node:assert"
import { describe, it } from "vitest"

import { createOsmPbfReader } from "../src/pbf/osm-pbf-reader"
import { PBFs } from "./files"
import { getFileReadStream } from "./utils"
import { PrimitiveBlockParser } from "../src/pbf/primitive-block-parser"
import { nodeToFeature, wayToFeature } from "../src/to-geojson"
import type { OsmNode } from "../src/types"
import { isWay } from "../src/utils"

describe("generate geojson from osm pbf", () => {
	it.each(Object.entries(PBFs))("%s", { timeout: 100_000 }, async (_, pbf) => {
		const fileStream = await getFileReadStream(pbf.url)
		const osm = await createOsmPbfReader(fileStream)
		assert.deepEqual(osm.header.bbox, pbf.bbox)

		const features: GeoJSON.Feature[] = []
		const nodes: Map<number, OsmNode> = new Map()
		for await (const block of osm.blocks) {
			const blockParser = new PrimitiveBlockParser(block)
			for await (const entity of blockParser) {
				if (Array.isArray(entity)) {
					for (const node of entity) {
						nodes.set(node.id, node)
						if (node.tags && Object.keys(node.tags).length > 0) {
							features.push(nodeToFeature(node))
						}
					}
				} else if (isWay(entity)) {
					features.push(wayToFeature(entity, nodes))
				}
			}
		}

		assert.equal(features.length, pbf.geoJsonFeatures)
	})
})
