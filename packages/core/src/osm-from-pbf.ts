import { readOsmPbf } from "@osmix/pbf"
import { Osm } from "./osm"
import { throttle } from "./utils"

/**
 * Create an OSM entity index from an ArrayBuffer or ReadableStream of OSM PBF data. Assumes data is sorted with nodes, then ways, then relations.
 *
 * @param data - The PBF data to read.
 * @param onProgress - A function to call with progress updates.
 * @returns The OSM index.
 */
export async function createOsmIndexFromPbfData(
	data: ArrayBufferLike | ReadableStream<ArrayBufferLike>,
	id = "unknown",
	onProgress: (...args: string[]) => void = console.log,
) {
	const { header, blocks } = await readOsmPbf(data)
	const osm = new Osm(id, header)
	const logEverySecond = throttle(onProgress, 1_000)

	let entityCount = 0
	let stage: "nodes" | "ways" | "relations" = "nodes"
	for await (const block of blocks) {
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
						`Loaded ${osm.nodes.size.toLocaleString()} nodes. Sorting node IDs...`,
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
						`Loaded ${osm.ways.size.toLocaleString()} ways. Sorting way IDs...`,
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
	onProgress(
		`Loaded ${osm.relations.size.toLocaleString()} relations. Sorting relation IDs...`,
	)
	osm.relations.finish()
	onProgress("Building spatial indexes for nodes and ways...")
	osm.finish()
	onProgress(
		`Added ${osm.nodes.size.toLocaleString()} nodes, ${osm.ways.size.toLocaleString()} ways, and ${osm.relations.size.toLocaleString()} relations.`,
	)
	return osm
}
