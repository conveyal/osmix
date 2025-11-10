import {
	type OsmEntity,
	OsmJsonToBlocksTransformStream,
	type OsmNode,
	type OsmRelation,
	type OsmWay,
} from "@osmix/json"
import {
	type AsyncGeneratorValue,
	OsmBlocksToPbfBytesTransformStream,
	type OsmPbfHeaderBlock,
	readOsmPbf,
} from "@osmix/pbf"
import { Osmix, type OsmixOptions } from "./osmix"
import { throttle } from "./utils"

/**
 * Read an OSM PBF file into an Osmix index.
 */
export async function osmixFromPbf(
	data: AsyncGeneratorValue<Uint8Array<ArrayBufferLike>>,
	options: Partial<OsmixOptions> = {},
): Promise<Osmix> {
	const osm = new Osmix(options)
	const { extractBbox } = options
	const { header, blocks } = await readOsmPbf(data)
	osm.header = header
	if (extractBbox) {
		osm.header.bbox = {
			left: extractBbox[0],
			bottom: extractBbox[1],
			right: extractBbox[2],
			top: extractBbox[3],
		}
	}
	const log = options.logger ?? ((...msg) => console.log(...msg))
	const logEverySecond = throttle(log, 1_000)

	for await (const block of blocks) {
		const blockStringIndexMap = osm.stringTable.createBlockIndexMap(block)

		for (const group of block.primitivegroup) {
			const { nodes, ways, relations, dense } = group
			if (nodes && nodes.length > 0) {
				throw Error("Nodes must be dense!")
			}

			if (dense) {
				osm.nodes.addDenseNodes(
					dense,
					block,
					blockStringIndexMap,
					extractBbox
						? (node: OsmNode) => {
								return (
									node.lon >= extractBbox[0] &&
									node.lon <= extractBbox[2] &&
									node.lat >= extractBbox[1] &&
									node.lat <= extractBbox[3]
								)
							}
						: undefined,
				)

				logEverySecond(`${osm.nodes.size.toLocaleString()} nodes added`)
			}

			if (ways.length > 0) {
				// Nodes are finished, build their index.
				if (!osm.nodes.isReady) osm.nodes.buildIndex()
				osm.ways.addWays(
					ways,
					blockStringIndexMap,
					extractBbox
						? (way: OsmWay) => {
								const refs = way.refs.filter((ref) => osm.nodes.ids.has(ref))
								if (refs.length === 0) return null
								return {
									...way,
									refs,
								}
							}
						: undefined,
				)

				logEverySecond(`${osm.ways.size.toLocaleString()} ways added`)
			}

			if (relations.length > 0) {
				if (!osm.ways.isReady) osm.ways.buildIndex()
				osm.relations.addRelations(
					relations,
					blockStringIndexMap,
					extractBbox
						? (relation: OsmRelation) => {
								const members = relation.members.filter((member) => {
									if (member.type === "node")
										return osm.nodes.ids.has(member.ref)
									if (member.type === "way") return osm.ways.ids.has(member.ref)
									return false
								})
								if (members.length === 0) return null
								return {
									...relation,
									members,
								}
							}
						: undefined,
				)

				logEverySecond(`${osm.relations.size.toLocaleString()} relations added`)
			}
		}
	}

	log(
		`${osm.nodes.size.toLocaleString()} nodes, ${osm.ways.size.toLocaleString()} ways, and ${osm.relations.size.toLocaleString()} relations added.`,
	)
	log("Building remaining id and tag indexes...")
	osm.buildIndexes()

	// By default, build all spatial indexes.
	if (!Array.isArray(options.buildSpatialIndexes)) {
		osm.buildSpatialIndexes()
	} else if (options.buildSpatialIndexes.includes("node")) {
		osm.nodes.buildSpatialIndex()
	} else if (options.buildSpatialIndexes.includes("way")) {
		osm.ways.buildSpatialIndex(osm.nodes)
	}

	return osm
}

/**
 * Convert the OSM index to a `ReadableStream<OsmPbfHeaderBlock | OsmEntity>`.
 */
export function createReadableEntityStreamFromOsmix(
	osm: Osmix,
): ReadableStream<OsmPbfHeaderBlock | OsmEntity> {
	let headerEnqueued = false
	const entityGenerator = osm.allEntitiesSorted()
	return new ReadableStream<OsmPbfHeaderBlock | OsmEntity>({
		pull: async (controller) => {
			if (!headerEnqueued) {
				controller.enqueue({
					...osm.header,
					writingprogram: "@osmix/core",
					osmosis_replication_timestamp: Date.now(),
				})
				headerEnqueued = true
			}
			const block = entityGenerator.next()
			if (block.done) {
				controller.close()
			} else {
				controller.enqueue(block.value)
			}
		},
	})
}

/**
 * Convert the OSM index to a `ReadableStream<Uint8Array>` of PBF bytes.
 */
export function osmixToPbfStream(osm: Osmix): ReadableStream<Uint8Array> {
	return createReadableEntityStreamFromOsmix(osm)
		.pipeThrough(new OsmJsonToBlocksTransformStream())
		.pipeThrough(new OsmBlocksToPbfBytesTransformStream())
}

/**
 * Convert the OSM index to an in memory PBF ArrayBuffer.
 */
export async function osmixToPbfBuffer(osm: Osmix): Promise<ArrayBuffer> {
	const chunks: Uint8Array[] = []
	let byteLength = 0
	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			chunks.push(chunk)
			byteLength += chunk.byteLength
		},
	})
	await osmixToPbfStream(osm).pipeTo(writable)
	const combined = new Uint8Array(byteLength)
	let offset = 0
	for (const chunk of chunks) {
		combined.set(chunk, offset)
		offset += chunk.byteLength
	}
	return combined.buffer
}
