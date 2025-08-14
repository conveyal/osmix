import { Osm } from "./osm"
import { OsmPbfReader } from "./pbf/osm-pbf-reader"
import { throttle } from "./utils"

/**
 * Create an OSM entity index from an ArrayBuffer or ReadableStream of OSM PBF data. Assumes data is sorted with nodes, then ways, then relations.
 *
 * @param data - The PBF data to read.
 * @param onProgress - A function to call with progress updates.
 * @returns The OSM index.
 */
export async function createOsmIndexFromPbfData(
	data: ArrayBuffer | ReadableStream<Uint8Array>,
	onProgress: (...args: string[]) => void = console.log,
) {
	const osm = new Osm()
	const reader = await OsmPbfReader.from(data)
	osm.header = reader.header

	const logEverySecond = throttle(onProgress, 1_000)

	let entityCount = 0
	let stage: "nodes" | "ways" | "relations" = "nodes"
	for await (const block of reader.blocks) {
		const blockStringIndexMap = osm.stringTable.createBlockIndexMap(block)
		for (const { nodes, ways, relations, dense } of block.primitivegroup) {
			if (dense) {
				osm.nodes.addDenseNodes(dense, block, blockStringIndexMap)
				entityCount += dense.id.length
			}

			if (nodes.length > 0) {
				for (const node of nodes) {
					osm.nodes.addNode(node)
				}
				entityCount += nodes.length
			}

			if (ways.length > 0) {
				if (stage === "nodes") {
					onProgress(
						`Loaded ${osm.nodes.size.toLocaleString()} nodes. Building node spatial index...`,
					)
					osm.nodes.finish()
					stage = "ways"
					entityCount = 0
				}
				osm.ways.addWays(ways, blockStringIndexMap)
				entityCount += ways.length
			}

			if (relations.length > 0) {
				if (stage === "ways") {
					onProgress(
						`Loaded ${osm.ways.size.toLocaleString()} ways. Building way spatial index...`,
					)
					osm.ways.finish()
					stage = "relations"
					entityCount = 0
				}
				osm.relations.addRelations(relations, blockStringIndexMap)
				entityCount += relations.length
			}

			logEverySecond(`${entityCount.toLocaleString()} ${stage} loaded`)
		}
	}
	osm.finish()
	onProgress(
		`Added ${osm.nodes.size.toLocaleString()} nodes, ${osm.ways.size.toLocaleString()} ways, and ${osm.relations.size.toLocaleString()} relations.`,
	)
	return osm
}
